// allow: SIZE_OK — Task 10 keeps native-session lifecycle wiring in this module.
import type * as Monaco from "monaco-editor";
import { markerToDiagnostic } from "@/lib/editor/diagnostics";
import {
  fileUriToWorkspaceRelativePath,
  isLspDocumentUriInWorkspace,
  monacoLanguageForPath,
  toLowerCaseUriKey,
} from "@/lib/lsp/document-scope";
import { LSP_DIAGNOSTIC_MARKER_OWNER } from "@/lib/lsp/types";
import { useDiagnosticsStore } from "@/stores/diagnostics-store";
import { useLspStore } from "@/stores/lsp-store";
import {
  connectLspBrowserTransport,
  type LspBrowserTransport,
} from "@/lib/lsp/client/browser-transport";
import { suppressBuiltinTypeScriptFeatures } from "@/lib/lsp/client/builtin-typescript";
import {
  clearPendingNavigation,
  getLspOpenFileHandler,
  isPendingNavigationCurrent,
  markPendingNavigationOpened,
  setPendingNavigation,
} from "@/lib/lsp/client/navigation-registry";

let registeredMonaco: typeof Monaco | null = null;
const featureStores = new WeakMap<object, { dispose(): void }>();

function isDefinitionTarget(value: unknown): value is {
  readonly targetUri?: string | null;
  readonly uri?: string;
} {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  return (
    (!("targetUri" in value) ||
      value.targetUri === null ||
      value.targetUri === undefined ||
      typeof value.targetUri === "string") &&
    (!("uri" in value) ||
      value.uri === undefined ||
      typeof value.uri === "string")
  );
}

export interface LspSessionHandle {
  readonly workspaceId: string;
  dispose(): void;
}

export function registerLspMonacoInstance(monaco: typeof Monaco): void {
  if (registeredMonaco !== null) return;
  registeredMonaco = monaco;
  useLspStore.getState().markMonacoRegistered();
}

export function getRegisteredLspMonaco(): typeof Monaco | null {
  return registeredMonaco;
}

export function createDisposableLspClient(
  monaco: typeof Monaco,
  transport: LspBrowserTransport,
): Monaco.IDisposable {
  class DevHubLspClient extends monaco.lsp.MonacoLspClient {
    protected override createFeatures() {
      const store = super.createFeatures();
      featureStores.set(this, store);
      return store;
    }
  }
  const client = new DevHubLspClient(
    // The local transport's unknown JSON payloads bridge Monaco's private Message type.
    transport as unknown as ConstructorParameters<
      typeof monaco.lsp.MonacoLspClient
    >[0],
  );
  return { dispose: () => featureStores.get(client)?.dispose() };
}

export async function ensureDefinitionTargetModels(
  monaco: typeof Monaco,
  result: unknown,
  workspaceId: string,
  workspaceRoot: string,
): Promise<unknown> {
  if (result === null) return null;
  const isArray = Array.isArray(result);
  const locations: readonly unknown[] = isArray ? result : [result];
  const retained: unknown[] = [];
  for (const location of locations) {
    if (!isDefinitionTarget(location)) continue;
    const target = location.targetUri ?? location.uri;
    if (
      !target ||
      !isLspDocumentUriInWorkspace(target, workspaceRoot, {
        isCaseInsensitive: false,
      })
    )
      continue;
    if (
      monaco.editor
        .getModels()
        .some(
          (model) =>
            model.uri.toString().toLowerCase() === target.toLowerCase(),
        )
    ) {
      retained.push(location);
      continue;
    }
    const relativePath = fileUriToWorkspaceRelativePath(target, workspaceRoot);
    if (relativePath === null) continue;
    try {
      const response = await fetch(
        `/api/files/content?workspaceId=${encodeURIComponent(workspaceId)}&path=${encodeURIComponent(relativePath)}`,
      );
      if (!response.ok) continue;
      const data: unknown = await response.json();
      if (
        typeof data !== "object" ||
        data === null ||
        Array.isArray(data) ||
        !("content" in data) ||
        typeof data.content !== "string"
      ) {
        throw new TypeError("Invalid file content response");
      }
      const model = monaco.editor.createModel(
        data.content,
        monacoLanguageForPath(relativePath) ?? undefined,
        monaco.Uri.parse(target),
      );
      // An editor may show and leave the model between checks; Monaco work on it can still be in flight.
      let wasAttachmentChanged = false;
      model.onDidChangeAttached(() => {
        wasAttachmentChanged = true;
      });
      const disposeWhenUnattached = () => {
        if (model.isDisposed()) return;
        if (
          wasAttachmentChanged ||
          model.isAttachedToEditor() ||
          monaco.editor
            .getEditors()
            .some((editor) => editor.getModel() === model)
        ) {
          wasAttachmentChanged = false;
          setTimeout(disposeWhenUnattached, 10_000);
          return;
        }
        model.dispose();
      };
      setTimeout(disposeWhenUnattached, 10_000);
      retained.push(location);
    } catch {
      // A failed prefetch must drop this target before Monaco translates its range.
      continue;
    }
  }
  return isArray ? retained : (retained[0] ?? null);
}

export async function connectLspSession({
  wsUrl,
  workspaceId,
  workspaceRoot,
  onUnexpectedClose,
}: {
  readonly wsUrl: string;
  readonly workspaceId: string;
  readonly workspaceRoot: string;
  readonly onUnexpectedClose: (code: number, reason: string) => void;
}): Promise<LspSessionHandle> {
  const monaco = getRegisteredLspMonaco();
  if (!monaco) throw new Error("Monaco not registered");
  suppressBuiltinTypeScriptFeatures(monaco);
  let transport: LspBrowserTransport | undefined;
  let client: Monaco.IDisposable | undefined;
  let opener: Monaco.IDisposable | undefined;
  let mirror: Monaco.IDisposable | undefined;
  try {
    transport = await connectLspBrowserTransport({
      url: wsUrl,
      workspaceRoot,
      resolveDefinitionTargets: (result) =>
        ensureDefinitionTargetModels(
          monaco,
          result,
          workspaceId,
          workspaceRoot,
        ),
      resolveDocumentUri: (sent) => {
        const key = sent.toLowerCase();
        const model = monaco.editor
          .getModels()
          .find(
            (candidate) => candidate.uri.toString(true).toLowerCase() === key,
          );
        return model ? model.uri.toString() : null;
      },
      normalizeIncomingUri: (uri) => monaco.Uri.parse(uri).toString(true),
      onUnexpectedClose,
    });
    client = createDisposableLspClient(monaco, transport);
    opener = monaco.editor.registerEditorOpener({
      openCodeEditor(source, resource, selectionOrPosition) {
        const uri = resource.toString();
        if (source.getModel()?.uri.toString() === uri) return false;
        if (
          !isLspDocumentUriInWorkspace(uri, workspaceRoot, {
            isCaseInsensitive: false,
          })
        )
          return false;
        const surface = source
          .getContainerDomNode()
          .closest("[data-lsp-surface]")
          ?.getAttribute("data-lsp-surface");
        if (surface !== "files-page" && surface !== "split-panel") return false;
        const handler = getLspOpenFileHandler(surface);
        if (!handler) return false;
        const relativePath = fileUriToWorkspaceRelativePath(uri, workspaceRoot);
        if (relativePath === null) return false;
        const position =
          selectionOrPosition && "startLineNumber" in selectionOrPosition
            ? {
                lineNumber: selectionOrPosition.startLineNumber,
                column: selectionOrPosition.startColumn,
              }
            : (selectionOrPosition ?? { lineNumber: 1, column: 1 });
        const token = setPendingNavigation(surface, {
          uriKey: toLowerCaseUriKey(uri),
          ...position,
        });
        void handler(relativePath, () =>
          isPendingNavigationCurrent(surface, token),
        ).then(
          (opened) => {
            if (opened) markPendingNavigationOpened(surface, token);
            else clearPendingNavigation(surface, token);
          },
          () => clearPendingNavigation(surface, token),
        );
        return true;
      },
    });
    const lastWritten = new Map<string, string>();
    mirror = monaco.editor.onDidChangeMarkers((uris) => {
      for (const uri of uris) {
        const key = uri.toString();
        if (
          !isLspDocumentUriInWorkspace(key, workspaceRoot, {
            isCaseInsensitive: false,
          })
        )
          continue;
        const relativePath = fileUriToWorkspaceRelativePath(key, workspaceRoot);
        if (relativePath === null) continue;
        const next = monaco.editor
          .getModelMarkers({
            owner: LSP_DIAGNOSTIC_MARKER_OWNER,
            resource: uri,
          })
          .map(markerToDiagnostic);
        const serialized = JSON.stringify(next);
        if (serialized === lastWritten.get(key)) continue;
        useDiagnosticsStore
          .getState()
          .setDiagnosticsForSource(
            workspaceId,
            relativePath,
            "typescript",
            next,
          );
        lastWritten.set(key, serialized);
      }
    });
  } catch (error) {
    mirror?.dispose();
    opener?.dispose();
    client?.dispose();
    transport?.detach();
    monaco.editor.removeAllMarkers(LSP_DIAGNOSTIC_MARKER_OWNER);
    throw error;
  }
  let isDisposed = false;
  return {
    workspaceId,
    dispose() {
      if (isDisposed) return;
      isDisposed = true;
      client.dispose();
      transport.detach();
      monaco.editor.removeAllMarkers(LSP_DIAGNOSTIC_MARKER_OWNER);
      mirror.dispose();
      opener.dispose();
      useDiagnosticsStore
        .getState()
        .clearSourceForWorkspace(workspaceId, "typescript");
    },
  };
}

import type * as Monaco from "monaco-editor";
import { markerToDiagnostic } from "@/lib/editor/diagnostics";
import {
  fileUriToWorkspaceRelativePath,
  isLspDocumentUriInWorkspace,
} from "@/lib/lsp/document-scope";
import { LSP_DIAGNOSTIC_MARKER_OWNER } from "@/lib/lsp/types";
import { useDiagnosticsStore } from "@/stores/diagnostics-store";

export function isLspMarkerOwner(owner: string): boolean {
  // ExtHostDiagnostics appends its numeric id when a collection name collides.
  return (
    owner === LSP_DIAGNOSTIC_MARKER_OWNER ||
    (owner.startsWith(LSP_DIAGNOSTIC_MARKER_OWNER) &&
      /^\d+$/.test(owner.slice(LSP_DIAGNOSTIC_MARKER_OWNER.length)))
  );
}

export function startDiagnosticsMirror({
  monaco,
  workspaceId,
  workspaceRoot,
}: {
  readonly monaco: typeof Monaco;
  readonly workspaceId: string;
  readonly workspaceRoot: string;
}): Monaco.IDisposable {
  const sync = (uris: readonly Monaco.Uri[]) => {
    for (const resource of uris) {
      const uri = resource.toString();
      if (
        !isLspDocumentUriInWorkspace(uri, workspaceRoot, {
          isCaseInsensitive: false,
        })
      )
        continue;
      const relativePath = fileUriToWorkspaceRelativePath(uri, workspaceRoot);
      if (relativePath === null) continue;
      const next = monaco.editor
        .getModelMarkers({ resource })
        .filter((marker) => isLspMarkerOwner(marker.owner))
        .map(markerToDiagnostic);
      const store = useDiagnosticsStore.getState();
      const previous =
        store.diagnosticsBySource.get(`${workspaceId}:${relativePath}`)
          ?.typescript ?? [];
      // Compare against the existing store instead of retaining another per-URI cache.
      if (JSON.stringify(previous) === JSON.stringify(next)) continue;
      store.setDiagnosticsForSource(
        workspaceId,
        relativePath,
        "typescript",
        next,
      );
    }
  };
  const subscription = monaco.editor.onDidChangeMarkers(sync);
  // Include diagnostics published during client.start(), before the listener existed.
  sync(monaco.editor.getModelMarkers({}).map((marker) => marker.resource));
  return subscription;
}

import type * as Monaco from "monaco-editor";
import type { OpenEditor } from "@codingame/monaco-vscode-editor-service-override";
import { getActiveLspWorkspaceRoot } from "@/lib/lsp/client/lsp-session";
import {
  clearPendingNavigation,
  getLspOpenFileHandler,
  isPendingNavigationCurrent,
  markPendingNavigationOpened,
  setPendingNavigation,
} from "@/lib/lsp/client/navigation-registry";
import {
  getLspSurfaceOf,
  isEditorShowingUriKey,
  isTopLevelEditor,
  waitForEditorShowing,
} from "@/lib/lsp/client/open-editor-wait";
import {
  fileUriToWorkspaceRelativePath,
  isLspDocumentUriInWorkspace,
  toLowerCaseUriKey,
} from "@/lib/lsp/document-scope";

export { waitForEditorShowing } from "@/lib/lsp/client/open-editor-wait";

const EDITOR_SHOWING_TIMEOUT_MS = 5_000;
const EDITOR_SHOWING_INTERVAL_MS = 50;

type NavigationSelection = {
  readonly startLineNumber: number;
  readonly startColumn: number;
  readonly endLineNumber?: number;
  readonly endColumn?: number;
};

function isNavigationSelection(value: unknown): value is NavigationSelection {
  return (
    typeof value === "object" &&
    value !== null &&
    "startLineNumber" in value &&
    typeof value.startLineNumber === "number" &&
    "startColumn" in value &&
    typeof value.startColumn === "number"
  );
}

function readSelection(
  options: Parameters<OpenEditor>[1],
): NavigationSelection {
  const selection =
    options && "selection" in options ? options.selection : undefined;
  return isNavigationSelection(selection)
    ? selection
    : { startLineNumber: 1, startColumn: 1 };
}

function releaseWhenEditorLeavesModel(
  editor: Monaco.editor.ICodeEditor,
  modelRef: Parameters<OpenEditor>[0],
): void {
  let isReleased = false;
  const subscriptions: Monaco.IDisposable[] = [];
  const release = () => {
    if (isReleased) return;
    isReleased = true;
    for (const subscription of subscriptions) subscription.dispose();
    modelRef.dispose();
  };
  subscriptions.push(
    editor.onDidChangeModel(release),
    editor.onDidDispose(release),
  );
}

export const openEditorFromLsp: OpenEditor = async (
  modelRef,
  options,
  _sideBySide,
) => {
  const uri = modelRef.object.textEditorModel.uri.toString();
  const root = getActiveLspWorkspaceRoot();
  const relativePath =
    root === null ? null : fileUriToWorkspaceRelativePath(uri, root);
  if (
    root === null ||
    relativePath === null ||
    !isLspDocumentUriInWorkspace(uri, root, { isCaseInsensitive: false })
  ) {
    modelRef.dispose();
    return undefined;
  }
  // Capture the surface name now: the handler may switch tabs and remount the editor subtree.
  const surface = getLspSurfaceOf(document.activeElement);
  const handler = getLspOpenFileHandler(surface);
  if (surface === null || handler === undefined) {
    modelRef.dispose();
    return undefined;
  }
  const selection = readSelection(options);
  const token = setPendingNavigation(surface, {
    uriKey: toLowerCaseUriKey(uri),
    lineNumber: selection.startLineNumber,
    column: selection.startColumn,
  });
  const isCurrent = () => isPendingNavigationCurrent(surface, token);
  const isOpened = await handler(relativePath, isCurrent).catch(() => false);
  if (!isOpened) {
    clearPendingNavigation(surface, token);
    modelRef.dispose();
    return undefined;
  }
  markPendingNavigationOpened(surface, token);
  const editor = await waitForEditorShowing(uri, surface, {
    timeoutMs: EDITOR_SHOWING_TIMEOUT_MS,
    intervalMs: EDITOR_SHOWING_INTERVAL_MS,
    isCurrent,
  });
  // A newer navigation may have started while the wait was suspended.
  if (editor === null || !isCurrent()) {
    modelRef.dispose();
    return undefined;
  }
  const range = {
    startLineNumber: selection.startLineNumber,
    startColumn: selection.startColumn,
    endLineNumber: selection.endLineNumber ?? selection.startLineNumber,
    endColumn: selection.endColumn ?? selection.startColumn,
  };
  editor.setSelection(range);
  editor.revealRangeInCenter(range);
  editor.focus();
  releaseWhenEditorLeavesModel(editor, modelRef);
  return editor;
};

export function registerLspOpenGuard(
  monaco: typeof Monaco,
): Monaco.IDisposable {
  return monaco.editor.registerEditorOpener({
    openCodeEditor(source, resource) {
      const uri = resource.toString();
      if (source.getModel()?.uri.toString() === uri) return false;
      const sourceSurface = getLspSurfaceOf(source.getContainerDomNode());
      if (sourceSurface === null) return true;
      const uriKey = toLowerCaseUriKey(uri);
      return monaco.editor
        .getEditors()
        .some(
          (editor) =>
            editor !== source &&
            isTopLevelEditor(editor) &&
            isEditorShowingUriKey(editor, uriKey) &&
            getLspSurfaceOf(editor.getContainerDomNode()) !== sourceSurface,
        );
    },
  });
}

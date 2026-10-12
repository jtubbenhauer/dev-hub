import type * as Monaco from "monaco-editor";
import { getRegisteredLspMonaco } from "@/lib/lsp/client/lsp-session";
import { toLowerCaseUriKey } from "@/lib/lsp/document-scope";
import type { LspSurface } from "@/lib/lsp/types";

type CodeEditor = Monaco.editor.ICodeEditor;

export function getLspSurfaceOf(
  element: Element | null | undefined,
): LspSurface | null {
  const surface = element
    ?.closest("[data-lsp-surface]")
    ?.getAttribute("data-lsp-surface");
  return surface === "files-page" || surface === "split-panel" ? surface : null;
}

export function isTopLevelEditor(editor: CodeEditor): boolean {
  return !editor.getContainerDomNode().parentElement?.closest(".monaco-editor");
}

export function isEditorShowingUriKey(
  editor: CodeEditor,
  uriKey: string,
): boolean {
  const model = editor.getModel();
  return model !== null && toLowerCaseUriKey(model.uri.toString()) === uriKey;
}

function findEditorShowing(
  uriKey: string,
  surface: LspSurface,
): CodeEditor | null {
  const editors = getRegisteredLspMonaco()?.editor.getEditors() ?? [];
  return (
    editors.find((editor) => {
      const container = editor.getContainerDomNode();
      return (
        container.isConnected &&
        getLspSurfaceOf(container) === surface &&
        isTopLevelEditor(editor) &&
        isEditorShowingUriKey(editor, uriKey)
      );
    }) ?? null
  );
}

export function waitForEditorShowing(
  uri: string,
  surface: LspSurface,
  {
    timeoutMs,
    intervalMs,
    isCurrent,
  }: {
    readonly timeoutMs: number;
    readonly intervalMs: number;
    readonly isCurrent: () => boolean;
  },
): Promise<CodeEditor | null> {
  const uriKey = toLowerCaseUriKey(uri);
  return new Promise((resolve) => {
    let elapsedMs = 0;
    const poll = () => {
      if (!isCurrent()) {
        resolve(null);
        return;
      }
      const editor = findEditorShowing(uriKey, surface);
      if (editor !== null || elapsedMs >= timeoutMs) {
        resolve(editor);
        return;
      }
      elapsedMs += intervalMs;
      setTimeout(poll, intervalMs);
    };
    poll();
  });
}

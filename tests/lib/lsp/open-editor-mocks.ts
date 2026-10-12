import type * as Monaco from "monaco-editor";
import { vi } from "vitest";

const lspSessionState = vi.hoisted(() => ({
  root: "/Workspace" as string | null,
  editors: [] as Monaco.editor.ICodeEditor[],
  onGetEditors: undefined as (() => void) | undefined,
}));

vi.mock("@/lib/lsp/client/lsp-session", () => ({
  getActiveLspWorkspaceRoot: () => lspSessionState.root,
  getRegisteredLspMonaco: () => ({
    editor: {
      getEditors: () => {
        lspSessionState.onGetEditors?.();
        return lspSessionState.editors;
      },
    },
  }),
}));

export { lspSessionState };

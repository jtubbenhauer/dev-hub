import { vi } from "vitest";
import { MonacoLanguageClient } from "monaco-languageclient";
import type { TextDocument, Range } from "vscode";
import { LSP_APPLY_EDIT_COMMAND } from "@/lib/lsp/types";

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  unregister: vi.fn(),
  execute: vi.fn(),
  sendRequest: vi.fn<MonacoLanguageClient["sendRequest"]>(),
  sync: vi.fn<(...args: unknown[]) => Promise<void>>(),
  open: vi.fn<() => Promise<string | null>>(),
  close: vi.fn(),
  getMonaco: vi.fn(),
}));

vi.mock("vscode", () => ({
  commands: {
    registerCommand: (id: string, handler: (...args: unknown[]) => unknown) => {
      mocks.handlers.set(id, handler);
      return {
        dispose: () => {
          mocks.handlers.delete(id);
          mocks.unregister(id);
        },
      };
    },
    executeCommand: mocks.execute,
  },
}));
vi.mock("monaco-languageclient", () => ({
  MonacoLanguageClient: class {
    sendRequest = mocks.sendRequest;
  },
}));
vi.mock("@/lib/lsp/client/lsp-session", () => ({
  getRegisteredLspMonaco: mocks.getMonaco,
}));
vi.mock("@/lib/lsp/client/workspace-edit-sync", () => ({
  handleWorkspaceEditResult: mocks.sync,
}));
vi.mock("@/stores/lsp-dialog-store", () => ({
  useLspDialogStore: {
    getState: () => ({ open: mocks.open, close: mocks.close }),
  },
}));

const subscribe = () => ({ dispose: vi.fn() });
const client = new MonacoLanguageClient({
  name: "command-test",
  clientOptions: {},
  messageTransports: {
    reader: {
      onError: subscribe,
      onClose: subscribe,
      onPartialMessage: subscribe,
      listen: subscribe,
      dispose: vi.fn(),
    },
    writer: {
      onError: subscribe,
      onClose: subscribe,
      write: async () => {},
      end: vi.fn(),
      dispose: vi.fn(),
    },
  },
});
// Middleware forwards these opaque browser values without inspecting them.
const document = {
  uri: "file:///Workspace/src/a.ts",
} as unknown as TextDocument;
const range = {} as Range;
const token = {
  isCancellationRequested: false,
  onCancellationRequested: vi.fn(),
};
const context = { workspaceId: "workspace", workspaceRoot: "/Workspace" };
const uri = "file:///Workspace/src/a.ts";
const position = { line: 2, character: 4 };
const actionContext = { diagnostics: [], only: undefined, triggerKind: 1 };
const rename = {
  command: "editor.action.rename",
  arguments: [[uri, position]],
};
const commands = [
  {
    title: "Edit",
    command: LSP_APPLY_EDIT_COMMAND,
    arguments: ["edit-1", rename],
  },
  { title: "Rename", ...rename },
  { title: "Other", command: "typescript.other", arguments: [1] },
];
const expected = [
  { ...commands[0], command: "devhub.lsp.applyEdit" },
  {
    ...commands[1],
    command: "devhub.lsp.renameAt",
    arguments: [uri, position],
  },
  commands[2],
];
function editor(modelUri: string) {
  return {
    getModel: () => ({ uri: { toString: () => modelUri } }),
    setPosition: vi.fn(),
    focus: vi.fn(),
    trigger: vi.fn(),
  };
}
function run(id: string, ...args: unknown[]) {
  const handler = mocks.handlers.get(id);
  if (!handler) throw new Error(`Command not registered: ${id}`);
  return handler(...args);
}

export {
  actionContext,
  rename,
  commands,
  expected,
  mocks,
  client,
  document,
  range,
  token,
  context,
  uri,
  position,
  editor,
  run,
};

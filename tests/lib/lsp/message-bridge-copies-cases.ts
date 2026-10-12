import {
  LSP_APPLY_EDIT_COMMAND,
  type JsonRpcId,
  type JsonRpcMessage,
  type LspWorkspaceEdit,
} from "@/lib/lsp/types";

export const uri = "file:///Workspace/My%20App/src/Widget.tsx";
export const lowerUri = uri.toLowerCase();
export const edit: LspWorkspaceEdit = { changes: { [uri]: [] } };
export const notification = (
  method: string,
  params?: unknown,
): JsonRpcMessage => ({
  jsonrpc: "2.0",
  method,
  params,
});
export const request = (
  method: string,
  params?: unknown,
  id: JsonRpcId = 0,
): JsonRpcMessage => ({ jsonrpc: "2.0", id, method, params });
export const response = (
  result: unknown,
  id: JsonRpcId = 0,
): JsonRpcMessage => ({
  jsonrpc: "2.0",
  id,
  result,
});

type MutatingCase = {
  readonly name: string;
  readonly direction: "fromClient" | "fromServer";
  readonly pendingMethod?: string;
  readonly message: JsonRpcMessage;
};
export const internalCompletion = {
  label: "internal",
  command: { title: "", command: "_typescript.onCompletionAccepted" },
};
export const mutatingCases: MutatingCase[] = [
  {
    name: "client initialize gets anchored params",
    direction: "fromClient",
    message: request("initialize", {
      rootUri: null,
      capabilities: { workspace: { applyEdit: true }, textDocument: {} },
    }),
  },
  {
    name: "client didOpen gets the real-case URI and language",
    direction: "fromClient",
    message: notification("textDocument/didOpen", {
      textDocument: { uri: lowerUri, languageId: "x", version: 1, text: "a" },
    }),
  },
  {
    name: "client hover gets the real-case URI",
    direction: "fromClient",
    message: request("textDocument/hover", {
      textDocument: { uri: lowerUri },
      position: { line: 1, character: 2 },
    }),
  },
  {
    name: "client apply-edit command is answered locally",
    direction: "fromClient",
    message: request("workspace/executeCommand", {
      command: LSP_APPLY_EDIT_COMMAND,
      arguments: ["edit-404"],
    }),
  },
  {
    name: "server initialize capabilities are trimmed",
    direction: "fromServer",
    pendingMethod: "initialize",
    message: response({
      capabilities: {
        hoverProvider: true,
        diagnosticProvider: true,
        executeCommandProvider: {
          commands: ["_typescript.moveToFileRefactoring", "keep"],
        },
      },
    }),
  },
  {
    name: "server completion array loses internal commands",
    direction: "fromServer",
    pendingMethod: "textDocument/completion",
    message: response([internalCompletion, { label: "plain" }]),
  },
  {
    name: "server completion list loses internal commands",
    direction: "fromServer",
    pendingMethod: "textDocument/completion",
    message: response({ isIncomplete: false, items: [internalCompletion] }),
  },
  {
    name: "server completion resolve loses internal commands",
    direction: "fromServer",
    pendingMethod: "completionItem/resolve",
    message: response(internalCompletion),
  },
  {
    name: "server code actions get wrapped edits",
    direction: "fromServer",
    pendingMethod: "textDocument/codeAction",
    message: response([
      { title: "Fix", edit },
      { title: "Lazy", data: 1 },
    ]),
  },
  {
    name: "server resolved code action gets a wrapped edit",
    direction: "fromServer",
    pendingMethod: "codeAction/resolve",
    message: response({ title: "Fix", edit }),
  },
  {
    name: "server rename result is replaced after writing",
    direction: "fromServer",
    pendingMethod: "textDocument/rename",
    message: response(edit),
  },
  {
    name: "server registerCapability is filtered",
    direction: "fromServer",
    message: request("client/registerCapability", {
      registrations: [
        { id: "keep", method: "textDocument/hover" },
        { id: "drop", method: "workspace/symbol" },
      ],
    }),
  },
  {
    name: "server unregisterCapability is filtered",
    direction: "fromServer",
    message: request("client/unregisterCapability", {
      unregisterations: [
        { id: "keep", method: "textDocument/hover" },
        { id: "drop", method: "workspace/symbol" },
      ],
    }),
  },
  {
    name: "server applyEdit is written by the bridge",
    direction: "fromServer",
    message: request("workspace/applyEdit", { edit }),
  },
  {
    name: "server configuration request is answered locally",
    direction: "fromServer",
    message: request("workspace/configuration", {
      items: [{ section: "typescript" }],
    }),
  },
];

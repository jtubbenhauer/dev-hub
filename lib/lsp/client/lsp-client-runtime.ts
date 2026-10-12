export { MonacoLanguageClient } from "monaco-languageclient";
export { ErrorAction, CloseAction } from "vscode-languageclient/browser.js";
export * as vscode from "vscode";
export {
  toSocket,
  WebSocketMessageReader,
  WebSocketMessageWriter,
} from "vscode-ws-jsonrpc";
export { registerFileSystemOverlay } from "@codingame/monaco-vscode-files-service-override";
export { createWorkspaceFileSystemProvider } from "@/lib/lsp/client/workspace-file-system";
export { registerLspOpenGuard } from "@/lib/lsp/client/open-editor";
export { registerLspClientCommands } from "@/lib/lsp/client/lsp-commands";

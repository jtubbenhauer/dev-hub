export const LSP_DEFAULT_PORT = 7601;

export const LSP_DOCUMENT_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
] as const;

export const LSP_DIAGNOSTIC_MARKER_OWNER = "lsp";

export const LSP_NO_CONNECTION_IDLE_MS = 60_000;

export const LSP_CLOSE_CODES = {
  BUSY: 4001,
  STALE_EPOCH: 4002,
  NOT_RUNNING: 4003,
  SERVER_EXITED: 4004,
  WORKSPACE_MISMATCH: 4005,
} as const;

export const LSP_PHASE1_SERVER_CAPABILITIES = [
  "textDocumentSync",
  "hoverProvider",
  "signatureHelpProvider",
  "completionProvider",
  "definitionProvider",
  "typeDefinitionProvider",
  "implementationProvider",
  "documentFormattingProvider",
  "documentRangeFormattingProvider",
  "inlayHintProvider",
  "semanticTokensProvider",
] as const;

export const LSP_PHASE1_DYNAMIC_METHODS = [
  "textDocument/hover",
  "textDocument/signatureHelp",
  "textDocument/completion",
  "textDocument/definition",
  "textDocument/typeDefinition",
  "textDocument/implementation",
  "textDocument/formatting",
  "textDocument/rangeFormatting",
  "textDocument/inlayHint",
  "textDocument/semanticTokens",
] as const;

export const LSP_DEFINITION_METHODS = [
  "textDocument/definition",
  "textDocument/typeDefinition",
  "textDocument/implementation",
] as const;

export const LSP_PHASE1_CLIENT_REQUESTS = [
  "initialize",
  "shutdown",
  "textDocument/hover",
  "textDocument/signatureHelp",
  "textDocument/completion",
  "completionItem/resolve",
  "textDocument/definition",
  "textDocument/typeDefinition",
  "textDocument/implementation",
  "textDocument/formatting",
  "textDocument/rangeFormatting",
  "textDocument/inlayHint",
  "inlayHint/resolve",
  "textDocument/semanticTokens/full",
  "textDocument/semanticTokens/full/delta",
  "textDocument/semanticTokens/range",
] as const;

export const LSP_PHASE1_CLIENT_NOTIFICATIONS = [
  "initialized",
  "exit",
  "textDocument/didOpen",
  "textDocument/didChange",
  "textDocument/didClose",
  "textDocument/didSave",
  "$/cancelRequest",
] as const;

export type LspServerState = "stopped" | "starting" | "running" | "error";

export interface LspStatusResponse {
  workspaceId: string;
  serverEpoch: number | null;
  state: LspServerState;
  wsUrl: string | null;
  error: string | null;
}

export interface LspControlRequest {
  action: "start" | "stop";
  workspaceId: string;
}

export type LspErrorCode =
  | "UNAUTHORIZED"
  | "NOT_FOUND"
  | "REMOTE_WORKSPACE"
  | "LSP_BUSY"
  | "INVALID_REQUEST"
  | "LSP_PORT_UNAVAILABLE";

export type LspClientStatus =
  | "disabled"
  | "unavailable"
  | "waiting-for-editor"
  | "starting"
  | "connecting"
  | "connected"
  | "busy"
  | "error";

export type LspSurface = "files-page" | "split-panel";

export type JsonRpcId = number | string;

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: JsonRpcId;
  method: string;
  params?: unknown;
}

export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

export interface JsonRpcResponseError {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: JsonRpcId | null;
  result?: unknown;
  error?: JsonRpcResponseError;
}

export type JsonRpcMessage =
  | JsonRpcRequest
  | JsonRpcNotification
  | JsonRpcResponse;

export function buildLspWsUrl(
  port: number,
  workspaceId: string,
  epoch: number,
): string {
  return `ws://127.0.0.1:${port}/?workspaceId=${encodeURIComponent(workspaceId)}&epoch=${epoch}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hasJsonRpcVersion(message: Record<string, unknown>): boolean {
  return message.jsonrpc === "2.0";
}

// id 0 is a valid request id (the native Monaco client starts at 0): never test id by truthiness
function hasJsonRpcId(message: Record<string, unknown>): boolean {
  return typeof message.id === "number" || typeof message.id === "string";
}

export function isJsonRpcRequest(value: unknown): value is JsonRpcRequest {
  return (
    isRecord(value) &&
    hasJsonRpcVersion(value) &&
    typeof value.method === "string" &&
    hasJsonRpcId(value)
  );
}

export function isJsonRpcNotification(
  value: unknown,
): value is JsonRpcNotification {
  return (
    isRecord(value) &&
    hasJsonRpcVersion(value) &&
    typeof value.method === "string" &&
    !("id" in value)
  );
}

export function isJsonRpcResponse(value: unknown): value is JsonRpcResponse {
  return (
    isRecord(value) &&
    hasJsonRpcVersion(value) &&
    !("method" in value) &&
    "id" in value &&
    (hasJsonRpcId(value) || value.id === null) &&
    ("result" in value || "error" in value)
  );
}

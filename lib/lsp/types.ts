export * from "@/lib/lsp/workspace-edit-guards";
export * from "@/lib/lsp/phase2-profile";

export type LspPosition = { readonly line: number; readonly character: number };
export type LspRange = {
  readonly start: LspPosition;
  readonly end: LspPosition;
};
export type LspTextEdit = {
  readonly range: LspRange;
  readonly newText: string;
  readonly annotationId?: string;
};
export type LspCommand = {
  readonly title: string;
  readonly command: string;
  readonly arguments?: unknown[];
};
export type LspTextDocumentEdit = {
  readonly textDocument: {
    readonly uri: string;
    readonly version: number | null;
  };
  readonly edits: LspTextEdit[];
};
export type LspCreateFile = {
  readonly kind: "create";
  readonly uri: string;
  readonly options?: {
    readonly overwrite?: boolean;
    readonly ignoreIfExists?: boolean;
  };
  readonly annotationId?: string;
};
export type LspRenameFile = {
  readonly kind: "rename";
  readonly oldUri: string;
  readonly newUri: string;
  readonly options?: {
    readonly overwrite?: boolean;
    readonly ignoreIfExists?: boolean;
  };
  readonly annotationId?: string;
};
export type LspDeleteFile = {
  readonly kind: "delete";
  readonly uri: string;
  readonly options?: {
    readonly recursive?: boolean;
    readonly ignoreIfNotExists?: boolean;
  };
  readonly annotationId?: string;
};
export type LspWorkspaceEdit = {
  readonly changes?: Record<string, LspTextEdit[]>;
  readonly documentChanges?: (
    | LspTextDocumentEdit
    | LspCreateFile
    | LspRenameFile
    | LspDeleteFile
  )[];
  readonly changeAnnotations?: Record<
    string,
    {
      readonly label: string;
      readonly needsConfirmation?: boolean;
      readonly description?: string;
    }
  >;
};
export type LspWorkspaceEditResult = {
  readonly applied: boolean;
  readonly reason: string | null;
  readonly changedUris: string[];
  readonly createdUris: string[];
};
export type LspSyncedDocument = {
  readonly version: number;
  readonly text: string;
};

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

export const LSP_DIAGNOSTIC_MARKER_OWNER = "devhub-lsp";

export const LSP_NO_CONNECTION_IDLE_MS = 60_000;

export const LSP_EDITORLESS_RELEASE_MS = 300_000;

export const LSP_HEARTBEAT_INTERVAL_MS = 30_000;

export const LSP_CLOSE_CODES = {
  BUSY: 4001,
  STALE_EPOCH: 4002,
  NOT_RUNNING: 4003,
  SERVER_EXITED: 4004,
  WORKSPACE_MISMATCH: 4005,
} as const;

export type LspServerState = "stopped" | "starting" | "running" | "error";

export interface LspStatusResponse {
  workspaceId: string;
  serverEpoch: number | null;
  readonly pid: number | null;
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
  | "idle"
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

// id 0 is a valid request id: never test id by truthiness.
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

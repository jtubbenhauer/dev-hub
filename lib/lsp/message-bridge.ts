import {
  isLspDocumentUriInWorkspace,
  lspLanguageIdForPath,
  workspaceRootToFileUri,
} from "@/lib/lsp/document-scope";
import {
  isJsonRpcRequest,
  isJsonRpcResponse,
  type JsonRpcId,
  type JsonRpcMessage,
} from "@/lib/lsp/types";
import {
  getSettingsSection,
  type VTSLS_SETTINGS,
} from "@/lib/lsp/vtsls-settings";

export type BridgeOutput = {
  toServer: JsonRpcMessage[];
  toClient: JsonRpcMessage[];
};

type BridgeOptions = {
  readonly workspaceRoot: string;
  readonly resolveRealCaseUri: (uri: string) => string | null;
  readonly settings: typeof VTSLS_SETTINGS;
  readonly allowedServerCapabilities: readonly string[];
  readonly allowedDynamicMethods: readonly string[];
  readonly allowedClientRequests: readonly string[];
  readonly allowedClientNotifications: readonly string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function toClient(...messages: JsonRpcMessage[]): BridgeOutput {
  return { toServer: [], toClient: messages };
}

function toServer(...messages: JsonRpcMessage[]): BridgeOutput {
  return { toServer: messages, toClient: [] };
}

function response(id: JsonRpcId, result: unknown): JsonRpcMessage {
  return { jsonrpc: "2.0", id, result };
}

const SERVER_INTERNAL_COMMAND_PREFIXES = ["_typescript.", "_vtsls."];

function stripCompletionCommand(item: unknown): unknown {
  if (!isRecord(item)) return item;
  const command = record(item.command).command;
  if (
    typeof command !== "string" ||
    !SERVER_INTERNAL_COMMAND_PREFIXES.some((prefix) =>
      command.startsWith(prefix),
    )
  )
    return item;
  const cleaned = { ...item };
  delete cleaned.command;
  return cleaned;
}

export function createLspBridgeSession(options: BridgeOptions) {
  const { workspaceRoot, resolveRealCaseUri } = options;
  const rootUri = workspaceRootToFileUri(workspaceRoot);
  const name = workspaceRoot.split("/").at(-1) ?? workspaceRoot;
  const pendingClientRequests = new Map<JsonRpcId, string>();

  function forwardClient(message: JsonRpcMessage): BridgeOutput {
    if (isJsonRpcRequest(message)) {
      pendingClientRequests.set(message.id, message.method);
      if (pendingClientRequests.size > 10_000) pendingClientRequests.clear();
    }
    return toServer(message);
  }

  function fromClient(input: JsonRpcMessage): BridgeOutput {
    const message = structuredClone(input);
    if (isJsonRpcResponse(message)) return toServer(message);
    if (!("method" in message)) return toClient();
    const isRequest = isJsonRpcRequest(message);
    if (isRequest && !options.allowedClientRequests.includes(message.method)) {
      return toClient({
        jsonrpc: "2.0",
        id: message.id,
        error: {
          code: -32601,
          message: `Method not allowed by the dev-hub LSP bridge: ${message.method}`,
        },
      });
    }
    if (
      !isRequest &&
      !options.allowedClientNotifications.includes(message.method)
    )
      return toClient();
    const params = record(message.params);
    switch (message.method) {
      case "initialize":
        if (isRequest) {
          const capabilities = record(params.capabilities);
          message.params = {
            ...params,
            rootUri,
            rootPath: workspaceRoot,
            workspaceFolders: [{ uri: rootUri, name }],
            capabilities: {
              ...capabilities,
              workspace: {
                ...record(capabilities.workspace),
                configuration: true,
                workspaceFolders: true,
                didChangeConfiguration: { dynamicRegistration: false },
              },
            },
          };
          return forwardClient(message);
        }
        break;
      case "initialized":
        if (!isRequest)
          return toServer(message, {
            jsonrpc: "2.0",
            method: "workspace/didChangeConfiguration",
            params: { settings: structuredClone(options.settings) },
          });
        break;
      case "shutdown":
        if (isRequest) return toClient(response(message.id, null));
        break;
      case "exit":
        if (!isRequest) return toClient();
        break;
    }
    const textDocument = record(params.textDocument);
    if (typeof textDocument.uri === "string") {
      const real = resolveRealCaseUri(textDocument.uri);
      if (
        real === null ||
        !isLspDocumentUriInWorkspace(real, workspaceRoot, {
          isCaseInsensitive: false,
        })
      ) {
        return isRequest ? toClient(response(message.id, null)) : toClient();
      }
      message.params = {
        ...params,
        textDocument: {
          ...textDocument,
          uri: real,
          ...(message.method === "textDocument/didOpen"
            ? { languageId: lspLanguageIdForPath(real) }
            : {}),
        },
      };
    }
    return forwardClient(message);
  }

  function fromServer(input: JsonRpcMessage): BridgeOutput {
    const message = structuredClone(input);
    if (isJsonRpcResponse(message)) {
      const method =
        message.id === null ? undefined : pendingClientRequests.get(message.id);
      if (message.id !== null) pendingClientRequests.delete(message.id);
      const result = message.result;
      switch (method) {
        case "initialize":
          if (isRecord(result)) {
            result.capabilities = Object.fromEntries(
              Object.entries(record(result.capabilities)).filter(([key]) =>
                options.allowedServerCapabilities.includes(key),
              ),
            );
          }
          break;
        case "textDocument/completion":
          if (Array.isArray(result))
            message.result = result.map(stripCompletionCommand);
          else if (isRecord(result) && Array.isArray(result.items))
            result.items = result.items.map(stripCompletionCommand);
          break;
        case "completionItem/resolve":
          message.result = stripCompletionCommand(result);
          break;
      }
      return toClient(message);
    }
    if (isJsonRpcRequest(message)) {
      const params = record(message.params);
      switch (message.method) {
        case "client/registerCapability":
        case "client/unregisterCapability": {
          const key =
            message.method === "client/registerCapability"
              ? "registrations"
              : "unregisterations";
          const entries = params[key];
          const allowed = Array.isArray(entries)
            ? entries.filter(
                (entry: unknown) =>
                  isRecord(entry) &&
                  typeof entry.method === "string" &&
                  options.allowedDynamicMethods.includes(entry.method),
              )
            : [];
          if (allowed.length === 0) return toServer(response(message.id, null));
          message.params = { ...params, [key]: allowed };
          return toClient(message);
        }
        case "workspace/configuration": {
          const items = Array.isArray(params.items) ? params.items : [];
          const settings = items.map((item: unknown) => {
            const section = record(item).section;
            return getSettingsSection(
              typeof section === "string" ? section : undefined,
            );
          });
          return toServer(response(message.id, structuredClone(settings)));
        }
        case "workspace/workspaceFolders":
          return toServer(response(message.id, [{ uri: rootUri, name }]));
        case "workspace/applyEdit":
          return toServer(
            response(message.id, {
              applied: false,
              failureReason: "Workspace edits are not supported in Phase 1",
            }),
          );
        default:
          return toServer(response(message.id, null));
      }
    }
    return "method" in message &&
      message.method === "textDocument/publishDiagnostics"
      ? toClient(message)
      : toClient();
  }

  return { fromClient, fromServer };
}

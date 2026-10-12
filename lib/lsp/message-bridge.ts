import {
  isLspDocumentUriInWorkspace,
  lspLanguageIdForPath,
  workspaceRootToFileUri,
} from "@/lib/lsp/document-scope";
import {
  isJsonRpcRequest,
  isJsonRpcResponse,
  isLspRecord as isRecord,
  LSP_PHASE2_CLIENT_REQUESTS,
  LSP_PHASE2_CLIENT_NOTIFICATIONS,
  LSP_PHASE2_DYNAMIC_METHODS,
  type JsonRpcId,
  type JsonRpcMessage,
  type JsonRpcNotification,
  type JsonRpcRequest,
} from "@/lib/lsp/types";
import {
  getSettingsSection,
  type VTSLS_SETTINGS,
} from "@/lib/lsp/vtsls-settings";
import {
  record,
  toClient,
  toServer,
  response,
  type BridgeOutput,
} from "@/lib/lsp/bridge-protocol";
import { rewriteServerResult } from "@/lib/lsp/bridge-server-results";
import {
  createBridgeWorkspaceEdits,
  type ApplyWorkspaceEdit,
} from "@/lib/lsp/bridge-workspace-edits";
export type { BridgeOutput } from "@/lib/lsp/bridge-protocol";

type BridgeOptions = {
  readonly workspaceRoot: string;
  readonly resolveRealCaseUri: (uri: string) => string | null;
  readonly settings: typeof VTSLS_SETTINGS;
  readonly applyWorkspaceEdit: ApplyWorkspaceEdit;
};

export function createLspBridgeSession(options: BridgeOptions) {
  const { workspaceRoot, resolveRealCaseUri } = options;
  const rootUri = workspaceRootToFileUri(workspaceRoot);
  const name = workspaceRoot.split("/").at(-1) ?? workspaceRoot;
  const pendingClientRequests = new Map<JsonRpcId, string>();
  const phase2 = createBridgeWorkspaceEdits(options);
  const allowedClientRequests: readonly string[] = LSP_PHASE2_CLIENT_REQUESTS;
  const allowedClientNotifications: readonly string[] =
    LSP_PHASE2_CLIENT_NOTIFICATIONS;
  const allowedDynamicMethods: readonly string[] = LSP_PHASE2_DYNAMIC_METHODS;

  function forwardClient(message: JsonRpcMessage): BridgeOutput {
    if (isJsonRpcRequest(message)) {
      pendingClientRequests.set(message.id, message.method);
      if (pendingClientRequests.size > 10_000) pendingClientRequests.clear();
    }
    return toServer(message);
  }

  function withRealCaseDocument(
    message: JsonRpcRequest | JsonRpcNotification,
    params: Record<string, unknown>,
  ): JsonRpcMessage | null {
    const textDocument = record(params.textDocument);
    if (typeof textDocument.uri !== "string") return message;
    const real = resolveRealCaseUri(textDocument.uri);
    if (
      real === null ||
      !isLspDocumentUriInWorkspace(real, workspaceRoot, {
        isCaseInsensitive: false,
      })
    )
      return null;
    return {
      ...message,
      params: {
        ...params,
        textDocument: {
          ...textDocument,
          uri: real,
          ...(message.method === "textDocument/didOpen"
            ? { languageId: lspLanguageIdForPath(real) }
            : {}),
        },
      },
    };
  }

  function fromClient(message: JsonRpcMessage): BridgeOutput {
    if (isJsonRpcResponse(message)) return toServer(message);
    if (!("method" in message)) return toClient();
    const local = phase2.fromClient(message);
    if (local) return local;
    const isRequest = isJsonRpcRequest(message);
    if (isRequest && !allowedClientRequests.includes(message.method)) {
      return toClient({
        jsonrpc: "2.0",
        id: message.id,
        error: {
          code: -32601,
          message: `Method not allowed by the dev-hub LSP bridge: ${message.method}`,
        },
      });
    }
    if (!isRequest && !allowedClientNotifications.includes(message.method))
      return toClient();
    const params = record(message.params);
    switch (message.method) {
      case "initialize":
        if (isRequest) {
          const capabilities = record(params.capabilities);
          return forwardClient({
            ...message,
            params: {
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
            },
          });
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
    const forwarded = withRealCaseDocument(message, params);
    if (forwarded === null)
      return isRequest ? toClient(response(message.id, null)) : toClient();
    phase2.track(forwarded);
    return forwardClient(forwarded);
  }

  function fromServer(message: JsonRpcMessage): BridgeOutput {
    if (isJsonRpcResponse(message)) {
      const method =
        message.id === null ? undefined : pendingClientRequests.get(message.id);
      if (message.id !== null) pendingClientRequests.delete(message.id);
      const local = phase2.fromResponse(message, method);
      if (local) return local;
      return toClient(rewriteServerResult(message, method));
    }
    if (isJsonRpcRequest(message)) {
      const local = phase2.fromServerRequest(message);
      if (local) return local;
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
                  allowedDynamicMethods.includes(entry.method),
              )
            : [];
          if (allowed.length === 0) return toServer(response(message.id, null));
          return toClient({
            ...message,
            params: { ...params, [key]: allowed },
          });
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

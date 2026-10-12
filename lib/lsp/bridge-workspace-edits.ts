import {
  record,
  response,
  toClient,
  type BridgeOutput,
} from "@/lib/lsp/bridge-protocol";
import { trackSyncedDocument } from "@/lib/lsp/bridge-documents";
import {
  isJsonRpcNotification,
  isJsonRpcRequest,
  isLspCommand,
  isLspRecord,
  isLspWorkspaceEdit,
  LSP_APPLY_EDIT_COMMAND,
  LSP_DIRTY_DOCUMENTS_NOTIFICATION,
  LSP_EDIT_RESULT_NOTIFICATION,
  type JsonRpcMessage,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type LspCommand,
  type LspSyncedDocument,
  type LspWorkspaceEdit,
  type LspWorkspaceEditResult,
} from "@/lib/lsp/types";

export type ApplyWorkspaceEdit = (
  edit: LspWorkspaceEdit,
  synced: ReadonlyMap<string, LspSyncedDocument>,
  dirty: ReadonlySet<string>,
) => LspWorkspaceEditResult;
type PendingEdit = {
  readonly edit: LspWorkspaceEdit | null;
  readonly followUp: LspCommand | null;
};
function refused(reason: string): LspWorkspaceEditResult {
  return { applied: false, reason, changedUris: [], createdUris: [] };
}
function resultNotification(result: LspWorkspaceEditResult): JsonRpcMessage {
  return {
    jsonrpc: "2.0",
    method: LSP_EDIT_RESULT_NOTIFICATION,
    params: result,
  };
}
function watchedFiles(result: LspWorkspaceEditResult): JsonRpcMessage[] {
  if (!result.applied) return [];
  const created = new Set(result.createdUris);
  return [
    {
      jsonrpc: "2.0",
      method: "workspace/didChangeWatchedFiles",
      params: {
        changes: [
          ...result.createdUris.map((uri) => ({ uri, type: 1 })),
          ...result.changedUris
            .filter((uri) => !created.has(uri))
            .map((uri) => ({ uri, type: 2 })),
        ],
      },
    },
  ];
}

export function createBridgeWorkspaceEdits(options: {
  readonly resolveRealCaseUri: (uri: string) => string | null;
  readonly applyWorkspaceEdit: ApplyWorkspaceEdit;
}) {
  const synced = new Map<string, LspSyncedDocument>();
  let dirty = new Set<string>();
  const pendingEdits = new Map<string, PendingEdit>();
  let counter = 0;
  function apply(edit: unknown): LspWorkspaceEditResult {
    return isLspWorkspaceEdit(edit)
      ? options.applyWorkspaceEdit(edit, synced, dirty)
      : refused("malformed edit");
  }
  function fromClient(message: JsonRpcMessage): BridgeOutput | null {
    if (
      isJsonRpcNotification(message) &&
      message.method === LSP_DIRTY_DOCUMENTS_NOTIFICATION
    ) {
      const uris = record(message.params).uris;
      if (
        Array.isArray(uris) &&
        uris.every((uri): uri is string => typeof uri === "string")
      )
        dirty = new Set(
          uris
            .map(options.resolveRealCaseUri)
            .filter((uri): uri is string => uri !== null),
        );
      return toClient();
    }
    if (
      !isJsonRpcRequest(message) ||
      message.method !== "workspace/executeCommand"
    )
      return null;
    const params = record(message.params);
    if (params.command !== LSP_APPLY_EDIT_COMMAND) return null;
    const editId: unknown = Array.isArray(params.arguments)
      ? params.arguments[0]
      : undefined;
    const entry =
      typeof editId === "string" ? pendingEdits.get(editId) : undefined;
    const result =
      entry === undefined
        ? refused("edit expired — run the action again")
        : apply(entry.edit);
    if (typeof editId === "string") pendingEdits.delete(editId);
    return {
      toClient: [response(message.id, result)],
      toServer: watchedFiles(result),
    };
  }
  function wrapAction(item: unknown): unknown {
    if (!isLspRecord(item) || !("edit" in item)) return item;
    let followUp: unknown = item.command;
    while (
      isLspCommand(followUp) &&
      (followUp.command === LSP_APPLY_EDIT_COMMAND ||
        followUp.command === "devhub.lsp.applyEdit")
    )
      followUp = followUp.arguments?.[1] ?? null;
    const command = isLspCommand(followUp) ? followUp : null;
    const editId = `edit-${++counter}`;
    pendingEdits.set(editId, {
      edit: isLspWorkspaceEdit(item.edit) ? item.edit : null,
      followUp: command,
    });
    if (pendingEdits.size > 200) {
      const oldest = pendingEdits.keys().next().value;
      if (oldest !== undefined) pendingEdits.delete(oldest);
    }
    const cleaned = { ...item };
    delete cleaned.edit;
    return {
      ...cleaned,
      command: {
        title: item.title,
        command: LSP_APPLY_EDIT_COMMAND,
        arguments: [editId, command],
      },
    };
  }
  function fromResponse(
    message: JsonRpcResponse,
    method: string | undefined,
  ): BridgeOutput | null {
    if (message.error !== undefined) return null;
    switch (method) {
      case "textDocument/rename": {
        if (message.result === null) return null;
        const result = apply(message.result);
        const reply: JsonRpcMessage = result.applied
          ? response(message.id, { changes: {} })
          : {
              jsonrpc: "2.0",
              id: message.id,
              error: {
                code: -32803,
                message: result.reason ?? "Edit not applied",
              },
            };
        return {
          toClient: [reply, resultNotification(result)],
          toServer: watchedFiles(result),
        };
      }
      case "textDocument/codeAction":
        return toClient({
          ...message,
          result: Array.isArray(message.result)
            ? message.result.map(wrapAction)
            : message.result,
        });
      case "codeAction/resolve":
        return toClient({ ...message, result: wrapAction(message.result) });
      default:
        return null;
    }
  }
  function fromServerRequest(message: JsonRpcRequest): BridgeOutput | null {
    if (message.method !== "workspace/applyEdit") return null;
    const result = apply(record(message.params).edit);
    return {
      toServer: [
        response(message.id, {
          applied: result.applied,
          failureReason: result.reason ?? undefined,
        }),
        ...watchedFiles(result),
      ],
      toClient: [resultNotification(result)],
    };
  }
  return {
    fromClient,
    fromResponse,
    fromServerRequest,
    track: (message: JsonRpcMessage) => trackSyncedDocument(message, synced),
  };
}

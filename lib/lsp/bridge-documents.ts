import { applyLspContentChanges } from "@/lib/lsp/text-edits";
import { record } from "@/lib/lsp/bridge-protocol";
import {
  isJsonRpcNotification,
  isLspRange,
  isLspRecord,
  type JsonRpcMessage,
  type LspRange,
  type LspSyncedDocument,
} from "@/lib/lsp/types";

function isContentChange(
  value: unknown,
): value is { text: string; range?: LspRange } {
  return (
    isLspRecord(value) &&
    typeof value.text === "string" &&
    (value.range === undefined || isLspRange(value.range))
  );
}

export function trackSyncedDocument(
  message: JsonRpcMessage,
  documents: Map<string, LspSyncedDocument>,
): void {
  if (!isJsonRpcNotification(message)) return;
  const params = record(message.params);
  const document = record(params.textDocument);
  const uri = document.uri;
  if (typeof uri !== "string") return;
  switch (message.method) {
    case "textDocument/didOpen":
      if (
        typeof document.version === "number" &&
        typeof document.text === "string"
      )
        documents.set(uri, { version: document.version, text: document.text });
      break;
    case "textDocument/didChange": {
      const current = documents.get(uri);
      if (
        current &&
        typeof document.version === "number" &&
        Array.isArray(params.contentChanges) &&
        params.contentChanges.every(isContentChange)
      )
        documents.set(uri, {
          version: document.version,
          text: applyLspContentChanges(current.text, params.contentChanges),
        });
      break;
    }
    case "textDocument/didClose":
      documents.delete(uri);
      break;
  }
}

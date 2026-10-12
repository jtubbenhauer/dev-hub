import {
  isLspRecord,
  type JsonRpcId,
  type JsonRpcMessage,
} from "@/lib/lsp/types";

export type BridgeOutput = {
  toServer: JsonRpcMessage[];
  toClient: JsonRpcMessage[];
};
export function record(value: unknown): Record<string, unknown> {
  return isLspRecord(value) ? value : {};
}
export function toClient(...messages: JsonRpcMessage[]): BridgeOutput {
  return { toServer: [], toClient: messages };
}
export function toServer(...messages: JsonRpcMessage[]): BridgeOutput {
  return { toServer: messages, toClient: [] };
}
export function response(
  id: JsonRpcId | null,
  result: unknown,
): JsonRpcMessage {
  return { jsonrpc: "2.0", id, result };
}

const SERVER_INTERNAL_COMMAND_PREFIXES = ["_typescript.", "_vtsls."];
export function stripCompletionCommand(item: unknown): unknown {
  if (!isLspRecord(item)) return item;
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

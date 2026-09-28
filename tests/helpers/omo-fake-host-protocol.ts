import type { JsonlRecord } from "@/lib/omo/jsonl";

export const DEFAULT_PROTOCOL_INFO = {
  protocolVersion: 1,
  serverVersion: "fake",
  mode: "multi",
  capabilities: [
    "multi_session",
    "retain_on_disconnect",
    "session_kind",
    "session_context",
    "extension_events",
  ],
} as const satisfies JsonlRecord;

export function stringField(
  record: JsonlRecord,
  key: string,
): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

export function recordField(
  record: JsonlRecord,
  key: string,
): JsonlRecord | undefined {
  const value = record[key];
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonlRecord)
    : undefined;
}

export function responseFor(
  request: JsonlRecord,
  response: JsonlRecord,
): JsonlRecord {
  return {
    id: request["id"],
    type: "response",
    command: stringField(request, "type") ?? "unknown",
    success: true,
    ...response,
  };
}

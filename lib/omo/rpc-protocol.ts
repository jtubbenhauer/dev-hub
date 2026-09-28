import { OmoCommandError, OmoIncompatibleHostError } from "@/lib/omo/errors";
import type { JsonlRecord } from "@/lib/omo/jsonl";

export const OMO_CLIENT_CAPABILITIES = [
  "extension_events",
  "question",
  "auto_title_sessions",
] as const;

export const OMO_REQUIRED_HOST_CAPABILITIES = [
  "multi_session",
  "retain_on_disconnect",
  "session_kind",
  "session_context",
  "extension_events",
] as const;

export type OmoProtocolInfo = {
  readonly protocolVersion: number;
  readonly mode: string;
  readonly capabilities: readonly string[];
  readonly serverVersion?: string;
};

export type OmoOpenedSession = JsonlRecord & {
  readonly sessionId: string;
};

export type OmoRequestOptions = {
  readonly timeoutMs?: number;
  readonly onResponse?: (response: JsonlRecord) => void;
};

export type OmoSessionBoundListener = (
  opened: OmoOpenedSession,
  bufferedRecords: readonly JsonlRecord[],
  overflowed: boolean,
) => void;

function isRecord(value: unknown): value is JsonlRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const strings = value.filter(
    (item): item is string => typeof item === "string",
  );
  return strings.length === value.length ? strings : undefined;
}

export function recordString(
  record: JsonlRecord,
  key: string,
): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

export function readCompatibleProtocolInfo(
  response: JsonlRecord,
): OmoProtocolInfo {
  const data = response["data"];
  if (!isRecord(data)) throw new OmoIncompatibleHostError(data);
  const protocolVersion = data["protocolVersion"];
  const mode = data["mode"];
  const capabilities = stringArray(data["capabilities"]);
  const serverVersion = data["serverVersion"];
  if (
    typeof protocolVersion !== "number" ||
    typeof mode !== "string" ||
    capabilities === undefined ||
    (serverVersion !== undefined && typeof serverVersion !== "string")
  ) {
    throw new OmoIncompatibleHostError(data);
  }
  const protocolInfo: OmoProtocolInfo = {
    protocolVersion,
    mode,
    capabilities,
    ...(typeof serverVersion === "string" ? { serverVersion } : {}),
  };
  const capabilitySet = new Set(capabilities);
  if (
    protocolVersion !== 1 ||
    mode !== "multi" ||
    !OMO_REQUIRED_HOST_CAPABILITIES.every((capability) =>
      capabilitySet.has(capability),
    )
  ) {
    throw new OmoIncompatibleHostError(protocolInfo);
  }
  return protocolInfo;
}

export function readOpenedSession(response: JsonlRecord): OmoOpenedSession {
  const data = response["data"];
  if (!isRecord(data)) throw new OmoIncompatibleHostError(data);
  const sessionId = recordString(data, "sessionId");
  if (sessionId === undefined) throw new OmoIncompatibleHostError(data);
  return { ...data, sessionId };
}

export function commandErrorFromResponse(
  response: JsonlRecord,
  fallbackCommand: string,
): OmoCommandError {
  return new OmoCommandError(
    recordString(response, "command") ?? fallbackCommand,
    recordString(response, "error") ?? "Unknown OmO command error",
    recordString(response, "errorCode"),
    response["errorData"],
  );
}

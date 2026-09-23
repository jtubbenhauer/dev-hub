import type { MessageWithParts } from "@/lib/opencode/types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isTime(value: unknown, requiresEnd = false): boolean {
  return (
    isRecord(value) &&
    isNumber(value.start) &&
    (!requiresEnd || isNumber(value.end)) &&
    (value.end === undefined || isNumber(value.end))
  );
}

function isTokens(value: unknown): boolean {
  return (
    isRecord(value) &&
    isNumber(value.input) &&
    isNumber(value.output) &&
    isNumber(value.reasoning) &&
    isRecord(value.cache) &&
    isNumber(value.cache.read) &&
    isNumber(value.cache.write)
  );
}

function isToolState(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value.input)) return false;
  switch (value.status) {
    case "pending":
      return typeof value.raw === "string";
    case "running":
      return isTime(value.time);
    case "completed":
      return (
        typeof value.output === "string" &&
        typeof value.title === "string" &&
        isRecord(value.metadata) &&
        isTime(value.time, true)
      );
    case "error":
      return typeof value.error === "string" && isTime(value.time, true);
    default:
      return false;
  }
}

function isPart(value: unknown, sessionId: string, messageId: string): boolean {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    value.sessionID !== sessionId ||
    value.messageID !== messageId
  ) {
    return false;
  }
  switch (value.type) {
    case "text":
      return typeof value.text === "string";
    case "subtask":
      return (
        typeof value.prompt === "string" &&
        typeof value.description === "string" &&
        typeof value.agent === "string"
      );
    case "reasoning":
      return typeof value.text === "string" && isTime(value.time);
    case "file":
      return typeof value.mime === "string" && typeof value.url === "string";
    case "tool":
      return (
        typeof value.callID === "string" &&
        typeof value.tool === "string" &&
        isToolState(value.state)
      );
    case "step-start":
      return value.snapshot === undefined || typeof value.snapshot === "string";
    case "step-finish":
      return (
        typeof value.reason === "string" &&
        isNumber(value.cost) &&
        isTokens(value.tokens)
      );
    case "snapshot":
      return typeof value.snapshot === "string";
    case "patch":
      return (
        typeof value.hash === "string" &&
        Array.isArray(value.files) &&
        value.files.every((file) => typeof file === "string")
      );
    case "agent":
      return typeof value.name === "string";
    case "retry":
      return (
        isNumber(value.attempt) &&
        isRecord(value.error) &&
        isRecord(value.time) &&
        isNumber(value.time.created)
      );
    case "compaction":
      return typeof value.auto === "boolean";
    default:
      return false;
  }
}

interface MessageIdentity {
  readonly id: string;
  readonly sessionID: string;
}

function isMessageInfo(value: unknown): value is MessageIdentity {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.sessionID !== "string" ||
    !isRecord(value.time) ||
    !isNumber(value.time.created)
  ) {
    return false;
  }
  switch (value.role) {
    case "user":
      return (
        typeof value.agent === "string" &&
        isRecord(value.model) &&
        typeof value.model.providerID === "string" &&
        typeof value.model.modelID === "string"
      );
    case "assistant":
      return (
        typeof value.parentID === "string" &&
        typeof value.modelID === "string" &&
        typeof value.providerID === "string" &&
        typeof value.mode === "string" &&
        isRecord(value.path) &&
        typeof value.path.cwd === "string" &&
        typeof value.path.root === "string" &&
        isNumber(value.cost) &&
        isTokens(value.tokens)
      );
    default:
      return false;
  }
}

export function isMessageWithParts(value: unknown): value is MessageWithParts {
  if (!isRecord(value) || !isMessageInfo(value.info)) return false;
  const info = value.info;
  return (
    Array.isArray(value.parts) &&
    value.parts.every((part) => isPart(part, info.sessionID, info.id))
  );
}

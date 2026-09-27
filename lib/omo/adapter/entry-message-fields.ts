import type { AssistantMessage } from "@opencode-ai/sdk";
import type { AgentMessageLike } from "@/lib/omo/sessions-on-disk";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export interface CanonicalUsage {
  readonly input: number;
  readonly output: number;
  readonly cost?: number;
  readonly cacheRead?: number;
  readonly cacheWrite?: number;
}

export function messageTimestamp(
  message: AgentMessageLike,
  fallback: number,
): number {
  return finiteNumber(message.timestamp, fallback);
}

export function messageString(
  message: AgentMessageLike,
  key: string,
): string | undefined {
  if (!isRecord(message)) return undefined;
  const value = message[key];
  return typeof value === "string" ? value : undefined;
}

export function messageBoolean(
  message: AgentMessageLike,
  key: string,
): boolean {
  return isRecord(message) && message[key] === true;
}

export function messageUsage(message: AgentMessageLike): CanonicalUsage {
  if (!isRecord(message) || !isRecord(message.usage)) {
    return { input: 0, output: 0 };
  }
  const usage = message.usage;
  const nestedCost = isRecord(usage.cost) ? usage.cost.total : usage.cost;
  return {
    input: finiteNumber(usage.input),
    output: finiteNumber(usage.output),
    cost: finiteNumber(nestedCost),
    cacheRead: finiteNumber(usage.cacheRead),
    cacheWrite: finiteNumber(usage.cacheWrite),
  };
}

export function messageError(
  message: AgentMessageLike,
): AssistantMessage["error"] | undefined {
  if (messageString(message, "stopReason") !== "error") return undefined;
  return {
    name: "UnknownError",
    data: { message: messageString(message, "errorMessage") ?? "OMO error" },
  };
}

export function displayText(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value) ?? "";
}

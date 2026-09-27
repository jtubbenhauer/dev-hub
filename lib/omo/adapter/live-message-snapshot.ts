import type { AssistantMessage } from "@opencode-ai/sdk";
import type { JsonlRecord } from "@/lib/omo/jsonl";
import type {
  AgentMessageLike,
  SessionMessageEntry,
} from "@/lib/omo/sessions-on-disk";
import type { MessageWithParts } from "@/lib/opencode/types";
import {
  buildOmoAssistantMessage,
  buildOmoUserMessage,
} from "@/lib/omo/adapter/shapes";
import {
  buildAssistantContent,
  buildUserContent,
} from "@/lib/omo/adapter/entry-content";
import {
  messageError,
  messageString,
  messageTimestamp,
  messageUsage,
  type CanonicalUsage,
} from "@/lib/omo/adapter/entry-message-fields";

export type LiveMessageRole = "user" | "assistant";

export interface AppendedLiveMessage {
  readonly entry: SessionMessageEntry;
  readonly role: LiveMessageRole;
}

export interface SnapshotOptions {
  readonly sessionId: string;
  readonly workspacePath: string;
  readonly skillPrefixes: readonly string[];
  readonly parentMessageID: string;
  readonly lastKnownModel: string;
  readonly lastKnownProvider: string;
  readonly fallbackAssistant?: AssistantMessage;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function recordTimestamp(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return fallback;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function parseAgentMessage(value: unknown): AgentMessageLike | undefined {
  if (
    !isRecord(value) ||
    typeof value.role !== "string" ||
    !("content" in value)
  ) {
    return undefined;
  }
  return { ...value, role: value.role, content: value.content };
}

export function parseLiveRole(value: string): LiveMessageRole | undefined {
  return value === "user" || value === "assistant" ? value : undefined;
}

export function parseAppendedLiveMessage(
  record: JsonlRecord,
): AppendedLiveMessage | undefined {
  if (!isRecord(record.entry) || typeof record.entry.id !== "string") {
    return undefined;
  }
  const message = parseAgentMessage(record.entry.message);
  if (!message) return undefined;
  const role = parseLiveRole(message.role);
  if (!role) return undefined;
  const timestamp = recordTimestamp(record.timestamp);
  return {
    role,
    entry: {
      type: "message",
      id: record.entry.id,
      parentId:
        typeof record.entry.parentId === "string" ? record.entry.parentId : null,
      timestamp,
      message,
    },
  };
}

function assistantUsage(
  message: AgentMessageLike,
  fallback: AssistantMessage | undefined,
): CanonicalUsage {
  if (isRecord(message) && isRecord(message.usage)) {
    return messageUsage(message);
  }
  if (!fallback) return { input: 0, output: 0 };
  return {
    input: fallback.tokens.input,
    output: fallback.tokens.output,
    cost: fallback.cost,
    cacheRead: fallback.tokens.cache.read,
    cacheWrite: fallback.tokens.cache.write,
  };
}

export function buildDurableLiveMessage(
  appended: AppendedLiveMessage,
  options: SnapshotOptions,
): MessageWithParts {
  const { entry, role } = appended;
  const id = `omo_${entry.id}`;
  const created = messageTimestamp(entry.message, entry.timestamp);
  if (role === "user") {
    const content = buildUserContent(entry.message, {
      entryId: entry.id,
      sessionID: options.sessionId,
      messageID: id,
      created,
      skillPrefixes: options.skillPrefixes,
    });
    return {
      info: buildOmoUserMessage({
        id,
        sessionID: options.sessionId,
        created,
        agent: content.agent,
        model: {
          providerID: options.lastKnownProvider,
          modelID: options.lastKnownModel,
        },
      }),
      parts: content.parts,
    };
  }

  const content = buildAssistantContent(entry.message, {
    entryId: entry.id,
    sessionID: options.sessionId,
    messageID: id,
    created,
  });
  const stopReason = messageString(entry.message, "stopReason");
  return {
    info: buildOmoAssistantMessage({
      id,
      sessionID: options.sessionId,
      parentMessageID: options.parentMessageID,
      created,
      completed: stopReason === "pending" ? undefined : entry.timestamp,
      modelID:
        messageString(entry.message, "model") ??
        options.fallbackAssistant?.modelID ??
        options.lastKnownModel,
      providerID:
        messageString(entry.message, "provider") ??
        options.fallbackAssistant?.providerID ??
        options.lastKnownProvider,
      cwd: options.workspacePath,
      usage: assistantUsage(entry.message, options.fallbackAssistant),
      error: messageError(entry.message),
    }),
    parts: content.parts,
  };
}

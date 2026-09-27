import type { ToolPart } from "@opencode-ai/sdk";
import type { MessageWithParts } from "@/lib/opencode/types";
import type {
  SessionEntry,
  SessionMessageEntry,
} from "@/lib/omo/sessions-on-disk";
import {
  buildOmoAssistantMessage,
  buildOmoTextPart,
  buildOmoUserMessage,
} from "@/lib/omo/adapter/shapes";
import {
  buildAssistantContent,
  buildUserContent,
  foldToolResult,
} from "@/lib/omo/adapter/entry-content";
import {
  displayText,
  messageError,
  messageString,
  messageTimestamp,
  messageUsage,
} from "@/lib/omo/adapter/entry-message-fields";

export interface ConversionContext {
  readonly sessionId: string;
  readonly workspacePath: string;
  readonly skillPrefixes: readonly string[];
  readonly messages: MessageWithParts[];
  readonly tools: Map<
    string,
    {
      readonly message: MessageWithParts;
      readonly start: number;
      readonly part: ToolPart;
    }
  >;
  lastKnownProvider: string;
  lastKnownModel: string;
  lastUserMessageID: string;
}

function messageID(entryId: string): string {
  return `omo_${entryId}`;
}

function appendUserMessage(
  entry: SessionMessageEntry,
  context: ConversionContext,
): void {
  const id = messageID(entry.id);
  const created = messageTimestamp(entry.message, entry.timestamp);
  const content = buildUserContent(entry.message, {
    entryId: entry.id,
    sessionID: context.sessionId,
    messageID: id,
    created,
    skillPrefixes: context.skillPrefixes,
  });
  const info = buildOmoUserMessage({
    id,
    sessionID: context.sessionId,
    created,
    agent: content.agent,
    model: {
      providerID: context.lastKnownProvider,
      modelID: context.lastKnownModel,
    },
  });
  context.messages.push({ info, parts: content.parts });
  context.lastUserMessageID = id;
}

function appendAssistantMessage(
  entry: SessionMessageEntry,
  context: ConversionContext,
): void {
  const id = messageID(entry.id);
  const created = messageTimestamp(entry.message, entry.timestamp);
  const stopReason = messageString(entry.message, "stopReason");
  const content = buildAssistantContent(entry.message, {
    entryId: entry.id,
    sessionID: context.sessionId,
    messageID: id,
    created,
  });
  const info = buildOmoAssistantMessage({
    id,
    sessionID: context.sessionId,
    parentMessageID: context.lastUserMessageID,
    created,
    completed: stopReason === "pending" ? undefined : entry.timestamp,
    modelID: messageString(entry.message, "model") ?? context.lastKnownModel,
    providerID:
      messageString(entry.message, "provider") ?? context.lastKnownProvider,
    cwd: context.workspacePath,
    usage: messageUsage(entry.message),
    error: messageError(entry.message),
  });
  const message = { info, parts: content.parts };
  context.messages.push(message);
  for (const part of content.toolParts) {
    context.tools.set(part.callID, { message, part, start: created });
  }
}

function foldResult(
  entry: SessionMessageEntry,
  context: ConversionContext,
): void {
  const callID = messageString(entry.message, "toolCallId");
  if (!callID) return;
  const target = context.tools.get(callID);
  if (!target) return;
  foldToolResult(target.part, target.message.parts, entry.message, {
    entryId: entry.id,
    timestamp: messageTimestamp(entry.message, entry.timestamp),
    start: target.start,
  });
}

function normalizeEntryUsage(value: unknown) {
  const message = { role: "assistant", content: [], usage: value };
  return messageUsage(message);
}

export function appendSyntheticMessage(
  specification: {
    readonly entry: SessionEntry;
    readonly text: string;
    readonly source: string;
    readonly isCompaction?: boolean;
  },
  context: ConversionContext,
): void {
  const { entry, text, source, isCompaction } = specification;
  const id = messageID(entry.id);
  const info = buildOmoAssistantMessage({
    id,
    sessionID: context.sessionId,
    parentMessageID: context.lastUserMessageID,
    created: entry.timestamp,
    completed: entry.timestamp,
    modelID: context.lastKnownModel,
    providerID: context.lastKnownProvider,
    cwd: context.workspacePath,
    usage:
      "usage" in entry
        ? normalizeEntryUsage(entry.usage)
        : { input: 0, output: 0 },
  });
  if (isCompaction) info.metadata = { compaction: true };
  const part = buildOmoTextPart({
    id: `omo_${entry.id}_0`,
    sessionID: context.sessionId,
    messageID: id,
    text,
  });
  if (!isCompaction) part.metadata = { omoSource: source };
  context.messages.push({ info, parts: [part] });
}

export function appendMessageEntry(
  entry: SessionMessageEntry,
  context: ConversionContext,
): void {
  switch (entry.message.role) {
    case "user":
      appendUserMessage(entry, context);
      return;
    case "assistant":
      appendAssistantMessage(entry, context);
      return;
    case "toolResult":
      foldResult(entry, context);
      return;
    case "bashExecution":
      appendSyntheticMessage(
        {
          entry,
          text: messageString(entry.message, "output") ?? "",
          source: "bashExecution",
        },
        context,
      );
      return;
    case "custom":
      appendSyntheticMessage(
        {
          entry,
          text: displayText(entry.message.content),
          source: "custom",
        },
        context,
      );
      return;
    case "branchSummary":
    case "compactionSummary":
      appendSyntheticMessage(
        {
          entry,
          text: messageString(entry.message, "summary") ?? "",
          source: entry.message.role,
        },
        context,
      );
      return;
    default:
      return;
  }
}

import type {
  AssistantMessage,
  Part,
  ReasoningPart,
  TextPart,
} from "@opencode-ai/sdk";
import type { JsonlRecord } from "@/lib/omo/jsonl";
import type { Event } from "@/lib/opencode/types";
import {
  buildOmoReasoningPart,
  buildOmoTextPart,
  buildOmoToolPart,
} from "@/lib/omo/adapter/shapes";
import { recordTimestamp } from "@/lib/omo/adapter/live-message-snapshot";

export interface ActiveAssistantMessage {
  readonly role: "assistant";
  readonly provisionalId: string;
  readonly created: number;
  readonly parts: Map<number, Part>;
  info: AssistantMessage;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function partUpdated(part: Part): Event {
  return { type: "message.part.updated", properties: { part } };
}

function partDelta(
  message: ActiveAssistantMessage,
  contentIndex: number,
  delta: string,
): Event {
  return {
    type: "message.part.delta",
    properties: {
      sessionID: message.info.sessionID,
      messageID: message.provisionalId,
      partID: `${message.provisionalId}_${contentIndex}`,
      field: "text",
      delta,
    },
  };
}

function contentIndex(event: Record<string, unknown>): number | undefined {
  return typeof event.contentIndex === "number" &&
    Number.isInteger(event.contentIndex) &&
    event.contentIndex >= 0
    ? event.contentIndex
    : undefined;
}

function textualPart(
  message: ActiveAssistantMessage,
  type: "text" | "reasoning",
  index: number,
  text: string,
  timestamp: number,
  isComplete: boolean,
): TextPart | ReasoningPart {
  const existing = message.parts.get(index);
  if (type === "text") {
    return buildOmoTextPart({
      id: `${message.provisionalId}_${index}`,
      sessionID: message.info.sessionID,
      messageID: message.provisionalId,
      text,
    });
  }
  const start =
    existing?.type === "reasoning" ? existing.time.start : timestamp;
  return buildOmoReasoningPart({
    id: `${message.provisionalId}_${index}`,
    sessionID: message.info.sessionID,
    messageID: message.provisionalId,
    text,
    start,
    end: isComplete ? timestamp : undefined,
  });
}

function handleTextEvent(
  record: JsonlRecord,
  event: Record<string, unknown>,
  message: ActiveAssistantMessage,
): Event[] {
  const index = contentIndex(event);
  if (index === undefined || typeof event.type !== "string") return [];
  const timestamp = recordTimestamp(record.timestamp, message.created);
  switch (event.type) {
    case "text_start":
    case "thinking_start": {
      const type = event.type === "text_start" ? "text" : "reasoning";
      const part = textualPart(message, type, index, "", timestamp, false);
      message.parts.set(index, part);
      return [partUpdated(part)];
    }
    case "text_delta":
    case "thinking_delta": {
      if (typeof event.delta !== "string") return [];
      const type = event.type === "text_delta" ? "text" : "reasoning";
      const existing = message.parts.get(index);
      const text =
        existing?.type === type ? existing.text + event.delta : event.delta;
      message.parts.set(
        index,
        textualPart(message, type, index, text, timestamp, false),
      );
      return [partDelta(message, index, event.delta)];
    }
    case "text_end":
    case "thinking_end": {
      const type = event.type === "text_end" ? "text" : "reasoning";
      const existing = message.parts.get(index);
      const text =
        typeof event.content === "string"
          ? event.content
          : existing?.type === type
            ? existing.text
            : "";
      const part = textualPart(message, type, index, text, timestamp, true);
      message.parts.set(index, part);
      return [partUpdated(part)];
    }
    default:
      return [];
  }
}

function handleToolEvent(
  record: JsonlRecord,
  event: Record<string, unknown>,
  message: ActiveAssistantMessage,
): Event[] {
  const index = contentIndex(event);
  if (index === undefined) return [];
  if (
    event.type === "toolcall_start" &&
    typeof event.id === "string" &&
    typeof event.toolName === "string"
  ) {
    const tool =
      typeof record.resolvedToolName === "string"
        ? record.resolvedToolName
        : event.toolName;
    const part = buildOmoToolPart({
      id: `omo_${event.id}`,
      sessionID: message.info.sessionID,
      messageID: message.provisionalId,
      callID: event.id,
      tool,
      state: { status: "pending", input: {}, raw: "" },
    });
    message.parts.set(index, part);
    return [partUpdated(part)];
  }
  if (event.type !== "toolcall_end" || !isRecord(event.toolCall)) return [];
  const existing = message.parts.get(index);
  if (existing?.type !== "tool") return [];
  const input = isRecord(event.toolCall.arguments)
    ? event.toolCall.arguments
    : {};
  const part = buildOmoToolPart({
    id: existing.id,
    sessionID: existing.sessionID,
    messageID: existing.messageID,
    callID: existing.callID,
    tool: existing.tool,
    state: { status: "pending", input, raw: JSON.stringify(input) },
  });
  message.parts.set(index, part);
  return [partUpdated(part)];
}

export function handleAssistantMessageUpdate(
  record: JsonlRecord,
  message: ActiveAssistantMessage,
): Event[] {
  if (!isRecord(record.assistantMessageEvent)) return [];
  const event = record.assistantMessageEvent;
  if (typeof event.type !== "string") return [];
  return event.type.startsWith("toolcall_")
    ? handleToolEvent(record, event, message)
    : handleTextEvent(record, event, message);
}

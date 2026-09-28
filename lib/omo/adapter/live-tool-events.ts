import type { Todo, ToolPart, ToolState } from "@opencode-ai/sdk";
import type {
  LiveAdapterOptions,
  LiveAdapterResult,
} from "@/lib/omo/adapter/live-adapter-types";
import type { ActiveAssistantMessage } from "@/lib/omo/adapter/live-message-updates";
import { recordTimestamp } from "@/lib/omo/adapter/live-message-snapshot";
import { createLiveTaskEventHandler } from "@/lib/omo/adapter/live-task-events";
import { buildOmoToolPart } from "@/lib/omo/adapter/shapes";
import type { JsonlRecord } from "@/lib/omo/jsonl";
import type { Event } from "@/lib/opencode/types";

export interface TrackedToolPart {
  part: ToolPart;
  readonly message?: ActiveAssistantMessage;
  readonly contentIndex?: number;
}

export interface LiveToolEventHandlers {
  readonly handleStart: (record: JsonlRecord) => LiveAdapterResult;
  readonly handleUpdate: (record: JsonlRecord) => LiveAdapterResult;
  readonly handleEnd: (record: JsonlRecord) => LiveAdapterResult;
  readonly handleExtension: (record: JsonlRecord) => LiveAdapterResult;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function partUpdated(part: ToolPart): Event {
  return { type: "message.part.updated", properties: { part } };
}

function textJoin(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((block) =>
      isRecord(block) && block.type === "text" && typeof block.text === "string"
        ? [block.text]
        : [],
    )
    .join("\n");
}

function resultFields(record: JsonlRecord): {
  readonly output: string;
  readonly metadata: Record<string, unknown>;
} {
  if (!isRecord(record.result)) return { output: "", metadata: {} };
  return {
    output: textJoin(record.result.content),
    metadata: isRecord(record.result.details) ? record.result.details : {},
  };
}

function normalizedTodoStatus(value: unknown): Todo["status"] {
  if (typeof value !== "string") return "pending";
  switch (value.toLowerCase().replaceAll("-", "_").replaceAll(" ", "_")) {
    case "in_progress":
    case "running":
      return "in_progress";
    case "complete":
    case "completed":
    case "done":
      return "completed";
    case "cancel":
    case "canceled":
    case "cancelled":
      return "cancelled";
    default:
      return "pending";
  }
}

function normalizeTodos(value: unknown): Todo[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate, index) => {
    if (!isRecord(candidate) || typeof candidate.content !== "string")
      return [];
    return [
      {
        id: typeof candidate.id === "string" ? candidate.id : String(index),
        content: candidate.content,
        status: normalizedTodoStatus(candidate.status),
        priority:
          typeof candidate.priority === "string"
            ? candidate.priority
            : "medium",
      },
    ];
  });
}

function stateMetadata(state: ToolState): Record<string, unknown> {
  return "metadata" in state && isRecord(state.metadata) ? state.metadata : {};
}

export function createLiveToolEventHandlers(
  options: LiveAdapterOptions,
  activeAssistant: () => ActiveAssistantMessage | undefined,
): LiveToolEventHandlers {
  const trackedTools = new Map<string, TrackedToolPart>();

  const rememberActiveTool = (callID: string): TrackedToolPart | undefined => {
    const active = activeAssistant();
    if (active) {
      for (const [contentIndex, part] of active.parts) {
        if (part.type !== "tool" || part.callID !== callID) continue;
        const tracked = { part, message: active, contentIndex };
        trackedTools.set(callID, tracked);
        return tracked;
      }
    }
    return trackedTools.get(callID);
  };

  const replacePart = (tracked: TrackedToolPart, part: ToolPart): Event => {
    tracked.part = part;
    if (tracked.message && tracked.contentIndex !== undefined) {
      tracked.message.parts.set(tracked.contentIndex, part);
    }
    return partUpdated(part);
  };

  const createTrackedPart = (
    callID: string,
    tool: string,
    state: ToolState,
  ): TrackedToolPart => {
    const active = activeAssistant();
    const contentIndex = active
      ? Math.max(-1, ...active.parts.keys()) + 1
      : undefined;
    const part = buildOmoToolPart({
      id: `omo_${callID}`,
      sessionID: options.sessionId,
      messageID: active?.provisionalId ?? options.sessionId,
      callID,
      tool,
      state,
    });
    const tracked =
      active && contentIndex !== undefined
        ? { part, message: active, contentIndex }
        : { part };
    if (active && contentIndex !== undefined)
      active.parts.set(contentIndex, part);
    trackedTools.set(callID, tracked);
    return tracked;
  };

  const handleStart = (record: JsonlRecord): LiveAdapterResult => {
    if (
      typeof record.toolCallId !== "string" ||
      typeof record.toolName !== "string"
    ) {
      return { events: [], effects: [] };
    }
    const input = isRecord(record.args) ? record.args : {};
    const state: ToolState = {
      status: "running",
      input,
      time: { start: recordTimestamp(record.timestamp, Date.now()) },
    };
    const tracked =
      rememberActiveTool(record.toolCallId) ??
      createTrackedPart(record.toolCallId, record.toolName, state);
    const part = buildOmoToolPart({
      id: tracked.part.id,
      sessionID: tracked.part.sessionID,
      messageID: tracked.part.messageID,
      callID: tracked.part.callID,
      tool: record.toolName,
      state,
    });
    return { events: [replacePart(tracked, part)], effects: [] };
  };

  const handleUpdate = (record: JsonlRecord): LiveAdapterResult => {
    if (typeof record.toolCallId !== "string")
      return { events: [], effects: [] };
    const tracked = rememberActiveTool(record.toolCallId);
    if (!tracked) return { events: [], effects: [] };
    const partialResult = isRecord(record.partialResult)
      ? record.partialResult
      : {};
    const previous = tracked.part.state;
    const runningState = {
      status: "running" as const,
      input: previous.input,
      output: textJoin(partialResult.content),
      metadata: stateMetadata(previous),
      time: {
        start:
          previous.status === "pending"
            ? recordTimestamp(record.timestamp, Date.now())
            : previous.time.start,
      },
    };
    const part = buildOmoToolPart({
      ...tracked.part,
      state: runningState,
    });
    return { events: [replacePart(tracked, part)], effects: [] };
  };

  const handleEnd = (record: JsonlRecord): LiveAdapterResult => {
    if (typeof record.toolCallId !== "string")
      return { events: [], effects: [] };
    const tracked = rememberActiveTool(record.toolCallId);
    if (!tracked) return { events: [], effects: [] };
    const ended = recordTimestamp(record.timestamp, Date.now());
    const previous = tracked.part.state;
    const start = previous.status === "pending" ? ended : previous.time.start;
    const result = resultFields(record);
    const errorState = {
      status: "error" as const,
      input: previous.input,
      error: result.output,
      output: result.output,
      metadata: result.metadata,
      time: { start, end: ended },
    };
    const state: ToolState =
      record.isError === true
        ? errorState
        : {
            status: "completed",
            input: previous.input,
            output: result.output,
            title: tracked.part.tool,
            metadata: result.metadata,
            time: { start, end: ended },
          };
    const part = buildOmoToolPart({ ...tracked.part, state });
    const events: Event[] = [replacePart(tracked, part)];
    if (options.todoToolName === part.tool) {
      events.push({
        type: "todo.updated",
        properties: {
          sessionID: options.sessionId,
          todos: normalizeTodos(previous.input["todos"]),
        },
      });
    }
    return { events, effects: [] };
  };

  const handleExtension = createLiveTaskEventHandler(
    options,
    () =>
      [...trackedTools.values()].filter(
        (tracked) => tracked.part.tool === "task",
      ),
    replacePart,
  );

  return { handleStart, handleUpdate, handleEnd, handleExtension };
}

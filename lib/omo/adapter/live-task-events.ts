import type { ToolPart, ToolState } from "@opencode-ai/sdk";
import type {
  Effect,
  LiveAdapterOptions,
  LiveAdapterResult,
} from "@/lib/omo/adapter/live-adapter-types";
import type { TrackedToolPart } from "@/lib/omo/adapter/live-tool-events";
import { recordTimestamp } from "@/lib/omo/adapter/live-message-snapshot";
import { buildOmoSession, buildOmoToolPart } from "@/lib/omo/adapter/shapes";
import type { JsonlRecord } from "@/lib/omo/jsonl";
import type { Event } from "@/lib/opencode/types";

interface ChildSessionState {
  readonly created: number;
  readonly indexFingerprint: string;
}

const TERMINAL_TASK_STATUSES = new Set([
  "cancelled",
  "completed",
  "error",
  "failed",
  "interrupted",
  "lost",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function withSessionMetadata(state: ToolState, sessionId: string): ToolState {
  if (state.status === "pending") return state;
  return {
    ...state,
    metadata: { ...state.metadata, sessionId },
  };
}

function toolPartMatchesTask(part: ToolPart, taskId: string): boolean {
  const state = part.state;
  const input = state.input;
  if (isRecord(input) && input.task_id === taskId) return true;
  const metadata = "metadata" in state ? state.metadata : undefined;
  if (isRecord(metadata) && metadata.task_id === taskId) return true;
  const output = "output" in state ? state.output : undefined;
  return typeof output === "string" && output.includes(taskId);
}

const TASK_ID_IN_OUTPUT = /\[task_id: ([^\s\]]+)/;

export function taskIdFromToolPart(part: ToolPart): string | undefined {
  const state = part.state;
  if (isRecord(state.input) && typeof state.input.task_id === "string") {
    return state.input.task_id;
  }
  const metadata = "metadata" in state ? state.metadata : undefined;
  if (isRecord(metadata) && typeof metadata.task_id === "string") {
    return metadata.task_id;
  }
  const output = "output" in state ? state.output : undefined;
  return typeof output === "string"
    ? TASK_ID_IN_OUTPUT.exec(output)?.[1]
    : undefined;
}

export function withChildSessionId(
  part: ToolPart,
  sessionId: string,
): ToolPart {
  return buildOmoToolPart({
    ...part,
    state: withSessionMetadata(part.state, sessionId),
  });
}

function optionalText(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function toolPartForTask(
  candidates: readonly TrackedToolPart[],
  taskId: string | undefined,
): TrackedToolPart | undefined {
  const matched =
    taskId === undefined
      ? undefined
      : candidates.find((tracked) => toolPartMatchesTask(tracked.part, taskId));
  if (matched) return matched;
  return candidates.length === 1 ? candidates[0] : undefined;
}

export function createLiveTaskEventHandler(
  options: LiveAdapterOptions,
  taskToolParts: () => readonly TrackedToolPart[],
  replacePart: (tracked: TrackedToolPart, part: ToolPart) => Event,
): (record: JsonlRecord) => LiveAdapterResult {
  const childSessions = new Map<string, ChildSessionState>();

  return (record): LiveAdapterResult => {
    if (record.name !== "omo.task.updated" || !isRecord(record.data)) {
      return { events: [], effects: [] };
    }
    const parentRawId = record.data.parent_session_id;
    const tasks = record.data.tasks;
    if (typeof parentRawId !== "string" || !Array.isArray(tasks)) {
      return { events: [], effects: [] };
    }
    const now = recordTimestamp(record.timestamp, Date.now());
    const events: Event[] = [];
    const effects: Effect[] = [];
    for (const task of tasks) {
      if (!isRecord(task)) continue;
      if (typeof task.child_session_id !== "string") {
        // omo runs tasks out of process and omits child_session_id; the
        // worker session is found later through its context.task_id.
        if (typeof task.task_id === "string") {
          const agent = optionalText(task.agent_type);
          const category = optionalText(task.category);
          effects.push({
            linkTaskChild: {
              parentDurableId: parentRawId,
              taskId: task.task_id,
              title:
                optionalText(task.task_summary) ?? agent ?? category ?? "task",
              ...(agent === undefined ? {} : { agent }),
              ...(category === undefined ? {} : { category }),
              updatedMs: now,
            },
          });
        }
        continue;
      }
      const rawChild = task.child_session_id;
      const agent =
        typeof task.agent_type === "string" ? task.agent_type : undefined;
      const category =
        typeof task.category === "string" ? task.category : undefined;
      const title = agent ?? category ?? "task";
      const fingerprint = JSON.stringify([parentRawId, agent, category, title]);
      const previous = childSessions.get(rawChild);
      const created = previous?.created ?? now;
      const session = buildOmoSession({
        rawId: rawChild,
        workspaceId: options.workspaceId,
        directory: options.workspacePath,
        title,
        created,
        updated: now,
        parentRawId,
      });
      events.push({
        type: previous ? "session.updated" : "session.created",
        properties: { info: session },
      });

      const taskId =
        typeof task.task_id === "string" ? task.task_id : undefined;
      const taskTool = toolPartForTask(taskToolParts(), taskId);
      if (taskTool) {
        const nextPart = buildOmoToolPart({
          ...taskTool.part,
          state: withSessionMetadata(taskTool.part.state, session.id),
        });
        events.push(replacePart(taskTool, nextPart));
      }

      if (!previous || previous.indexFingerprint !== fingerprint) {
        effects.push({
          mergeFromTaskEvent: {
            durableId: rawChild,
            workspaceId: options.workspaceId,
            parentDurableId: parentRawId,
            kind: "worker",
            ...(agent === undefined ? {} : { agent }),
            ...(category === undefined ? {} : { category }),
            title,
            createdMs: created,
            updatedMs: now,
          },
          refreshIndex: true,
        });
      }
      childSessions.set(rawChild, { created, indexFingerprint: fingerprint });
      if (
        typeof task.status === "string" &&
        TERMINAL_TASK_STATUSES.has(task.status.toLowerCase())
      ) {
        events.push({
          type: "session.idle",
          properties: { sessionID: session.id },
        });
      }
    }
    return { events, effects };
  };
}

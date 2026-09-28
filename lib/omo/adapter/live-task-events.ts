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

export function createLiveTaskEventHandler(
  options: LiveAdapterOptions,
  latestTaskTool: () => TrackedToolPart | undefined,
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
      if (!isRecord(task) || typeof task.child_session_id !== "string")
        continue;
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

      const taskTool = latestTaskTool();
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

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
import type { Event, SubAgentActivity } from "@/lib/opencode/types";

interface ChildSessionState {
  readonly created: number;
  readonly indexFingerprint: string;
  readonly statusType: "busy" | "idle" | undefined;
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

export function childSessionIdsFromState(state: ToolState): string[] {
  const metadata =
    "metadata" in state && isRecord(state.metadata) ? state.metadata : {};
  const ids = Array.isArray(metadata.sessionIds)
    ? metadata.sessionIds.filter((id): id is string => typeof id === "string")
    : [];
  if (
    typeof metadata.sessionId === "string" &&
    !ids.includes(metadata.sessionId)
  ) {
    ids.unshift(metadata.sessionId);
  }
  return ids;
}

// A single task call can fan out to several subagents, so every linked child
// is kept in sessionIds while sessionId stays the first for older readers.
function withSessionMetadata(state: ToolState, sessionId: string): ToolState {
  if (state.status === "pending") return state;
  const existing = childSessionIdsFromState(state);
  const sessionIds = existing.includes(sessionId)
    ? existing
    : [...existing, sessionId];
  return {
    ...state,
    metadata: { ...state.metadata, sessionId: sessionIds[0], sessionIds },
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

const ACTIVE_TASK_STATUSES = new Set(["pending", "queued", "running"]);

const TASK_ID_IN_OUTPUT = /\[task_id: ([^\s\]]+)/g;

export function taskIdsFromToolPart(part: ToolPart): string[] {
  const state = part.state;
  if (isRecord(state.input) && typeof state.input.task_id === "string") {
    return [state.input.task_id];
  }
  const metadata = "metadata" in state ? state.metadata : undefined;
  if (isRecord(metadata) && typeof metadata.task_id === "string") {
    return [metadata.task_id];
  }
  const output = "output" in state ? state.output : undefined;
  if (typeof output !== "string") return [];
  return [
    ...new Set(
      [...output.matchAll(TASK_ID_IN_OUTPUT)].map((match) => match[1]),
    ),
  ].filter((id): id is string => id !== undefined);
}

export function linkTaskChildToPart(
  candidates: readonly TrackedToolPart[],
  taskId: string,
  sessionId: string,
  replacePart: (tracked: TrackedToolPart, part: ToolPart) => Event,
): Event[] {
  const active = candidates.filter(
    (tracked) => tracked.part.state.status === "running",
  );
  const tracked =
    candidates.find((candidate) =>
      toolPartMatchesTask(candidate.part, taskId),
    ) ?? (active.length === 1 ? active[0] : undefined);
  if (
    tracked === undefined ||
    childSessionIdsFromState(tracked.part.state).includes(sessionId)
  ) {
    return [];
  }
  return [replacePart(tracked, withChildSessionId(tracked.part, sessionId))];
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

function taskStatus(task: Record<string, unknown>): string | undefined {
  return typeof task.status === "string"
    ? task.status.toLowerCase()
    : undefined;
}

function childStatusEvent(sessionID: string, isActive: boolean): Event {
  return {
    type: "session.status",
    properties: { sessionID, status: { type: isActive ? "busy" : "idle" } },
  };
}

function subAgentActivity(
  progress: unknown,
  updatedAt: number,
): SubAgentActivity | undefined {
  if (
    !isRecord(progress) ||
    typeof progress.activity !== "string" ||
    typeof progress.turns !== "number"
  ) {
    return undefined;
  }
  const currentTool = optionalText(progress.current_tool);
  const lastLine = optionalText(progress.last_assistant_line);
  return {
    summary: progress.activity,
    turns: progress.turns,
    updatedAt,
    ...(currentTool === undefined ? {} : { currentTool }),
    ...(lastLine === undefined ? {} : { lastLine }),
    ...(typeof progress.tool_calls === "number"
      ? { toolCalls: progress.tool_calls }
      : {}),
  };
}

function activityFingerprint(activity: SubAgentActivity): string {
  return JSON.stringify([
    activity.summary,
    activity.currentTool,
    activity.lastLine,
    activity.turns,
    activity.toolCalls,
  ]);
}

// omo lists every task the session has started in each update, so only an
// active task may fall back to the one running task call; a finished task from
// an earlier turn would otherwise attach its child to the newest Task card.
function toolPartForTask(
  candidates: readonly TrackedToolPart[],
  taskId: string | undefined,
  isTaskActive: boolean,
): TrackedToolPart | undefined {
  const matched =
    taskId === undefined
      ? undefined
      : candidates.find((tracked) => toolPartMatchesTask(tracked.part, taskId));
  if (matched) return matched;
  if (!isTaskActive) return undefined;
  const running = candidates.filter(
    (tracked) => tracked.part.state.status === "running",
  );
  return running.length === 1 ? running[0] : undefined;
}

export function createLiveTaskEventHandler(
  options: LiveAdapterOptions,
  taskToolParts: () => readonly TrackedToolPart[],
  replacePart: (tracked: TrackedToolPart, part: ToolPart) => Event,
): (record: JsonlRecord) => LiveAdapterResult {
  const childSessions = new Map<string, ChildSessionState>();
  const sentActivity = new Map<string, string>();

  // Every update repeats each task's live_progress, so only progress that
  // changed since it was last sent is returned.
  const changedActivity = (
    key: string,
    task: Record<string, unknown>,
    isActive: boolean,
    now: number,
  ): SubAgentActivity | undefined => {
    if (!isActive) {
      sentActivity.delete(key);
      return undefined;
    }
    const activity = subAgentActivity(task.live_progress, now);
    if (activity === undefined) return undefined;
    const fingerprint = activityFingerprint(activity);
    if (sentActivity.get(key) === fingerprint) return undefined;
    sentActivity.set(key, fingerprint);
    return activity;
  };

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
      const status = taskStatus(task);
      const isActive = status !== undefined && ACTIVE_TASK_STATUSES.has(status);
      if (typeof task.child_session_id !== "string") {
        // omo runs tasks out of process and omits child_session_id; the
        // worker session is found later through its context.task_id.
        if (typeof task.task_id === "string") {
          const agent = optionalText(task.agent_type);
          const category = optionalText(task.category);
          const activity = changedActivity(
            `task:${task.task_id}`,
            task,
            isActive,
            now,
          );
          effects.push({
            linkTaskChild: {
              parentDurableId: parentRawId,
              taskId: task.task_id,
              title:
                optionalText(task.task_summary) ?? agent ?? category ?? "task",
              ...(agent === undefined ? {} : { agent }),
              ...(category === undefined ? {} : { category }),
              updatedMs: now,
              isActive,
              ...(activity === undefined ? {} : { activity }),
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
      const taskTool = toolPartForTask(taskToolParts(), taskId, isActive);
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
      const isTerminal =
        status !== undefined && TERMINAL_TASK_STATUSES.has(status);
      const statusType = isActive
        ? "busy"
        : isTerminal
          ? "idle"
          : previous?.statusType;
      childSessions.set(rawChild, {
        created,
        indexFingerprint: fingerprint,
        statusType,
      });
      // Finished tasks repeat in every update: report only changes, and send
      // session.idle (which notifies the user) only for a task seen running.
      if (statusType !== undefined && statusType !== previous?.statusType) {
        events.push(childStatusEvent(session.id, statusType === "busy"));
        if (statusType === "idle" && previous?.statusType === "busy") {
          events.push({
            type: "session.idle",
            properties: { sessionID: session.id },
          });
        }
      }
      const activity = changedActivity(
        `child:${rawChild}`,
        task,
        isActive,
        now,
      );
      if (activity !== undefined) {
        events.push({
          type: "session.activity",
          properties: { sessionID: session.id, activity },
        });
      }
    }
    return { events, effects };
  };
}

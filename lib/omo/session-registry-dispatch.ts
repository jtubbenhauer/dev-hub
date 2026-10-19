import type { SessionStatus } from "@opencode-ai/sdk";
import {
  toSessionBackgroundStatus,
  type OmoBackgroundStatusKey,
  type OmoBackgroundStatusUpdate,
} from "@/lib/omo/adapter/background-status";
import type { Effect } from "@/lib/omo/adapter/live-adapter-types";
import type { JsonlRecord } from "@/lib/omo/jsonl";
import type {
  SessionBackgroundMonitor,
  SessionBackgroundStatus,
} from "@/lib/opencode/types";
import type { OmoRpcClient } from "@/lib/omo/rpc-client";
import { buildOmoSession } from "@/lib/omo/adapter/shapes";
import {
  findOmoWorkerByTaskId,
  mergeOmoSessionIndexFromTaskEvent,
  setOmoLeafAndActivity,
} from "@/lib/omo/session-index";
import { isJsonObject } from "@/lib/omo/session-registry-records";
import type {
  OmoRegistryEvent,
  OmoRegistryEventSink,
  OmoSessionBinding,
  OmoSessionRegistryWorkspace,
} from "@/lib/omo/session-registry-types";
import { normalizeTimestampMs } from "@/lib/omo/sessions-on-disk";

type OmoRegistryDispatcherOptions = {
  readonly client: OmoRpcClient;
  readonly refreshIndex: (
    workspace: OmoSessionRegistryWorkspace,
  ) => Promise<void>;
  readonly findSubAgentSessionIds: (
    workspace: OmoSessionRegistryWorkspace,
    taskId: string,
  ) => Promise<readonly string[]>;
};

type MergeFromTaskEventEffect = Extract<
  Effect,
  { readonly refreshIndex: true }
>;

type LinkTaskChildEffect = Extract<Effect, { readonly linkTaskChild: unknown }>;

type TaskChildLink = LinkTaskChildEffect["linkTaskChild"];

type BackgroundStatusEffect = Extract<
  Effect,
  { readonly backgroundStatus: unknown }
>;

type MonitorEntriesEffect = Extract<
  Effect,
  { readonly monitorEntries: unknown }
>;

type BackgroundStatusTexts = Map<OmoBackgroundStatusKey, string>;

const NO_BACKGROUND_TEXTS: BackgroundStatusTexts = new Map();

const MAX_LINKED_TASKS = 1_000;

function backgroundStatusEvent(
  sessionID: string,
  status: SessionBackgroundStatus | null,
): OmoRegistryEvent {
  return { type: "session.background", properties: { sessionID, status } };
}

// Workers run out of process, so their busy/idle state comes from omo task
// events rather than from a session dev-hub is attached to.
function workerStatusEvent(
  workerDurableId: string,
  isActive: boolean,
): OmoRegistryEvent {
  return {
    type: "session.status",
    properties: {
      sessionID: `omo_${workerDurableId}`,
      status: { type: isActive ? "busy" : "idle" },
    },
  };
}

// omo lists every task in each update, so a worker's status is sent only when
// it differs from the last status sent for that session.
function workerTaskEvents(
  workerDurableId: string,
  link: TaskChildLink,
  lastStatus: SessionStatus | undefined,
): OmoRegistryEvent[] {
  const events: OmoRegistryEvent[] =
    lastStatus?.type === (link.isActive ? "busy" : "idle")
      ? []
      : [workerStatusEvent(workerDurableId, link.isActive)];
  if (link.activity !== undefined) {
    events.push({
      type: "session.activity",
      properties: {
        sessionID: `omo_${workerDurableId}`,
        activity: link.activity,
      },
    });
  }
  return events;
}

export class OmoRegistryDispatcher {
  readonly leafQueue = new Map<string, Promise<void>>();
  private readonly client: OmoRpcClient;
  private readonly refreshIndex: OmoRegistryDispatcherOptions["refreshIndex"];
  private readonly findSubAgentSessionIds: OmoRegistryDispatcherOptions["findSubAgentSessionIds"];
  private readonly sinks = new Map<string, Set<OmoRegistryEventSink>>();
  private readonly linkedTaskWorkers = new Map<string, string>();
  // Per-session latest status only (busy/idle/retry) — bounded by session
  // count, unlike the unbounded event log this replaced.
  private readonly sessionStatuses = new Map<
    string,
    Map<string, SessionStatus>
  >();
  private readonly backgroundTexts = new Map<
    string,
    Map<string, BackgroundStatusTexts>
  >();
  private readonly backgroundMonitorEntries = new Map<
    string,
    Map<string, readonly SessionBackgroundMonitor[]>
  >();

  constructor(options: OmoRegistryDispatcherOptions) {
    this.client = options.client;
    this.refreshIndex = options.refreshIndex;
    this.findSubAgentSessionIds = options.findSubAgentSessionIds;
  }

  dispatch(
    binding: OmoSessionBinding,
    record: JsonlRecord,
  ): readonly OmoRegistryEvent[] {
    const result = binding.adapter.handle(record);
    const dialogEvents = binding.dialogs.handle(record, result.events);
    const events = [...result.events, ...dialogEvents];
    if (record["type"] === "entry_appended") this.queueLeaf(binding, record);
    for (const effect of result.effects) this.applyEffect(binding, effect);
    this.emit(binding.workspaceId, events);
    return events;
  }

  emitEvent(workspaceId: string, event: OmoRegistryEvent): void {
    this.emit(workspaceId, [event]);
  }

  enqueueLeaf(
    workspaceId: string,
    durableId: string,
    mutation: () => Promise<void>,
  ): Promise<void> {
    const key = `${workspaceId}:${durableId}`;
    const previous = this.leafQueue.get(key) ?? Promise.resolve();
    const tail = previous.catch(() => undefined).then(mutation);
    this.leafQueue.set(key, tail);
    void tail.then(
      () => this.deleteLeafTail(key, tail),
      () => this.deleteLeafTail(key, tail),
    );
    return tail;
  }

  sessionStatusesForWorkspace(
    workspaceId: string,
  ): Record<string, SessionStatus> {
    const statuses = this.sessionStatuses.get(workspaceId);
    return statuses === undefined ? {} : Object.fromEntries(statuses);
  }

  deleteSessionStatus(workspaceId: string, sessionID: string): void {
    this.sessionStatuses.get(workspaceId)?.delete(sessionID);
  }

  backgroundStatusesForWorkspace(
    workspaceId: string,
  ): Record<string, SessionBackgroundStatus> {
    const sessionIDs = new Set([
      ...(this.backgroundTexts.get(workspaceId)?.keys() ?? []),
      ...(this.backgroundMonitorEntries.get(workspaceId)?.keys() ?? []),
    ]);
    return Object.fromEntries(
      [...sessionIDs].flatMap((sessionID) => {
        const status = this.backgroundStatusFor(workspaceId, sessionID);
        return status === null ? [] : [[sessionID, status]];
      }),
    );
  }

  // A session dev-hub stops receiving records for can no longer vouch for its
  // goal or monitors, so its status is withdrawn rather than left to go stale.
  clearBackgroundStatus(workspaceId: string, sessionID: string): void {
    const sessions = this.backgroundTexts.get(workspaceId);
    const hadTexts = sessions?.delete(sessionID) === true;
    if (sessions?.size === 0) this.backgroundTexts.delete(workspaceId);
    const monitorSessions = this.backgroundMonitorEntries.get(workspaceId);
    const hadMonitorEntries = monitorSessions?.delete(sessionID) === true;
    if (monitorSessions?.size === 0) {
      this.backgroundMonitorEntries.delete(workspaceId);
    }
    if (!hadTexts && !hadMonitorEntries) return;
    this.emit(workspaceId, [backgroundStatusEvent(sessionID, null)]);
  }

  subscribe(workspaceId: string, sink: OmoRegistryEventSink): () => void {
    let workspaceSinks = this.sinks.get(workspaceId);
    if (workspaceSinks === undefined) {
      workspaceSinks = new Set();
      this.sinks.set(workspaceId, workspaceSinks);
    }
    if (workspaceSinks.has(sink)) return () => undefined;
    workspaceSinks.add(sink);
    this.client.addSubscriber();
    return () => this.unsubscribe(workspaceId, sink);
  }

  private unsubscribe(workspaceId: string, sink: OmoRegistryEventSink): void {
    const workspaceSinks = this.sinks.get(workspaceId);
    if (workspaceSinks === undefined || !workspaceSinks.delete(sink)) return;
    if (workspaceSinks.size === 0) this.sinks.delete(workspaceId);
    this.client.removeSubscriber();
  }

  subscriberCount(workspaceId: string): number {
    return this.sinks.get(workspaceId)?.size ?? 0;
  }

  clear(): void {
    this.leafQueue.clear();
    for (const workspaceSinks of this.sinks.values()) {
      for (const _sink of workspaceSinks) this.client.removeSubscriber();
    }
    this.sinks.clear();
    this.sessionStatuses.clear();
    this.backgroundTexts.clear();
    this.backgroundMonitorEntries.clear();
  }

  private queueLeaf(binding: OmoSessionBinding, record: JsonlRecord): void {
    const entry = record["entry"];
    if (!isJsonObject(entry) || typeof entry["id"] !== "string") return;
    const entryId = entry["id"];
    const message = isJsonObject(entry["message"])
      ? entry["message"]
      : undefined;
    const timestamp = message?.["timestamp"] ?? entry["timestamp"];
    const activityMs =
      typeof timestamp === "string" || typeof timestamp === "number"
        ? normalizeTimestampMs(timestamp)
        : Date.now();
    binding.effectTail = this.continueEffectTail(binding, () =>
      this.enqueueLeaf(binding.workspaceId, binding.durableId, () =>
        setOmoLeafAndActivity(
          binding.workspaceId,
          binding.durableId,
          entryId,
          activityMs,
        ),
      ),
    );
  }

  private applyEffect(binding: OmoSessionBinding, effect: Effect): void {
    if (this.isBackgroundStatusEffect(effect)) {
      this.applyBackgroundStatus(binding, effect.backgroundStatus);
      return;
    }
    if (this.isMonitorEntriesEffect(effect)) {
      this.applyMonitorEntries(binding, effect.monitorEntries);
      return;
    }
    if (this.isLinkEffect(effect)) {
      this.linkTaskChild(binding, effect.linkTaskChild);
      return;
    }
    if (!this.isMergeEffect(effect)) return;
    binding.effectTail = this.continueEffectTail(binding, async () => {
      await mergeOmoSessionIndexFromTaskEvent(binding.workspaceId, [
        effect.mergeFromTaskEvent,
      ]);
      await this.refreshIndex(binding.workspace);
    });
  }

  private linkTaskChild(binding: OmoSessionBinding, link: TaskChildLink): void {
    const key = `${binding.workspaceId}:${link.taskId}`;
    const knownWorkerId = this.linkedTaskWorkers.get(key);
    if (knownWorkerId !== undefined) {
      this.emit(
        binding.workspaceId,
        workerTaskEvents(
          knownWorkerId,
          link,
          this.lastWorkerStatus(binding.workspaceId, knownWorkerId),
        ),
      );
      return;
    }
    binding.effectTail = this.continueEffectTail(binding, async () => {
      const linkedWorkerId = this.linkedTaskWorkers.get(key);
      if (linkedWorkerId !== undefined) {
        this.emit(
          binding.workspaceId,
          workerTaskEvents(
            linkedWorkerId,
            link,
            this.lastWorkerStatus(binding.workspaceId, linkedWorkerId),
          ),
        );
        return;
      }
      await this.refreshIndex(binding.workspace);
      const worker = await findOmoWorkerByTaskId(
        binding.workspaceId,
        link.taskId,
      );
      // Out-of-process workers are never listed by omo, so the index cannot
      // name them; their transcript on disk still can.
      const workerDurableId =
        worker?.durableId ??
        (await this.findSubAgentSessionIds(binding.workspace, link.taskId))[0];
      if (workerDurableId === undefined) return;
      await mergeOmoSessionIndexFromTaskEvent(binding.workspaceId, [
        {
          durableId: workerDurableId,
          parentDurableId: link.parentDurableId,
          agent: link.agent,
          category: link.category,
          title: link.title,
          updatedMs: link.updatedMs,
        },
      ]);
      this.rememberLinkedTask(key, workerDurableId);
      this.emit(binding.workspaceId, [
        {
          type: "session.updated",
          properties: {
            info: buildOmoSession({
              rawId: workerDurableId,
              workspaceId: binding.workspaceId,
              directory: binding.workspace.path,
              title: link.title,
              created: worker?.createdMs ?? link.updatedMs,
              updated: link.updatedMs,
              parentRawId: link.parentDurableId,
            }),
          },
        },
        ...workerTaskEvents(
          workerDurableId,
          link,
          this.lastWorkerStatus(binding.workspaceId, workerDurableId),
        ),
        ...binding.adapter.linkTaskChild(link.taskId, `omo_${workerDurableId}`),
      ]);
    });
  }

  private lastWorkerStatus(
    workspaceId: string,
    workerDurableId: string,
  ): SessionStatus | undefined {
    return this.sessionStatuses.get(workspaceId)?.get(`omo_${workerDurableId}`);
  }

  private applyBackgroundStatus(
    binding: OmoSessionBinding,
    update: OmoBackgroundStatusUpdate,
  ): void {
    const sessionID = `omo_${binding.durableId}`;
    const sessions =
      this.backgroundTexts.get(binding.workspaceId) ??
      new Map<string, BackgroundStatusTexts>();
    const texts = sessions.get(sessionID) ?? new Map();
    if (texts.get(update.key) === update.text) return;
    if (update.text === undefined) {
      texts.delete(update.key);
    } else {
      texts.set(update.key, update.text);
    }
    if (texts.size === 0) {
      sessions.delete(sessionID);
    } else {
      sessions.set(sessionID, texts);
    }
    if (sessions.size === 0) {
      this.backgroundTexts.delete(binding.workspaceId);
    } else {
      this.backgroundTexts.set(binding.workspaceId, sessions);
    }
    this.emit(binding.workspaceId, [
      backgroundStatusEvent(
        sessionID,
        this.backgroundStatusFor(binding.workspaceId, sessionID),
      ),
    ]);
  }

  private applyMonitorEntries(
    binding: OmoSessionBinding,
    entries: readonly SessionBackgroundMonitor[],
  ): void {
    const sessionID = `omo_${binding.durableId}`;
    const sessions =
      this.backgroundMonitorEntries.get(binding.workspaceId) ??
      new Map<string, readonly SessionBackgroundMonitor[]>();
    const previous = sessions.get(sessionID) ?? [];
    if (JSON.stringify(previous) === JSON.stringify(entries)) return;
    if (entries.length === 0) {
      sessions.delete(sessionID);
    } else {
      sessions.set(sessionID, entries);
    }
    if (sessions.size === 0) {
      this.backgroundMonitorEntries.delete(binding.workspaceId);
    } else {
      this.backgroundMonitorEntries.set(binding.workspaceId, sessions);
    }
    this.emit(binding.workspaceId, [
      backgroundStatusEvent(
        sessionID,
        this.backgroundStatusFor(binding.workspaceId, sessionID),
      ),
    ]);
  }

  private backgroundStatusFor(
    workspaceId: string,
    sessionID: string,
  ): SessionBackgroundStatus | null {
    return toSessionBackgroundStatus(
      this.backgroundTexts.get(workspaceId)?.get(sessionID) ??
        NO_BACKGROUND_TEXTS,
      this.backgroundMonitorEntries.get(workspaceId)?.get(sessionID),
    );
  }

  private rememberLinkedTask(key: string, workerDurableId: string): void {
    this.linkedTaskWorkers.set(key, workerDurableId);
    if (this.linkedTaskWorkers.size <= MAX_LINKED_TASKS) return;
    const oldest = this.linkedTaskWorkers.keys().next().value;
    if (oldest !== undefined) this.linkedTaskWorkers.delete(oldest);
  }

  // Chains onto whatever effectTail already holds instead of replacing it,
  // and swallows a prior rejection so one failed effect never blocks the
  // next one from running.
  private continueEffectTail(
    binding: OmoSessionBinding,
    next: () => Promise<void>,
  ): Promise<void> {
    return binding.effectTail
      .catch((error: unknown) => {
        console.error("OmO effect chain step failed", error);
      })
      .then(next);
  }

  private isMergeEffect(effect: Effect): effect is MergeFromTaskEventEffect {
    const row =
      "mergeFromTaskEvent" in effect ? effect.mergeFromTaskEvent : undefined;
    return (
      isJsonObject(row) &&
      typeof row["durableId"] === "string" &&
      "refreshIndex" in effect &&
      effect.refreshIndex === true
    );
  }

  private isBackgroundStatusEffect(
    effect: Effect,
  ): effect is BackgroundStatusEffect {
    const update =
      "backgroundStatus" in effect ? effect.backgroundStatus : undefined;
    return isJsonObject(update) && typeof update["key"] === "string";
  }

  private isMonitorEntriesEffect(
    effect: Effect,
  ): effect is MonitorEntriesEffect {
    return "monitorEntries" in effect && Array.isArray(effect.monitorEntries);
  }

  private isLinkEffect(effect: Effect): effect is LinkTaskChildEffect {
    const link = "linkTaskChild" in effect ? effect.linkTaskChild : undefined;
    return (
      isJsonObject(link) &&
      typeof link["taskId"] === "string" &&
      typeof link["parentDurableId"] === "string"
    );
  }

  private deleteLeafTail(key: string, tail: Promise<void>): void {
    if (this.leafQueue.get(key) === tail) this.leafQueue.delete(key);
  }

  private emit(workspaceId: string, events: readonly OmoRegistryEvent[]): void {
    const sinks = [...(this.sinks.get(workspaceId) ?? [])];
    for (const event of events) {
      if (event.type === "session.status") {
        this.setSessionStatus(
          workspaceId,
          event.properties.sessionID,
          event.properties.status,
        );
      }
      for (const sink of sinks) {
        try {
          sink(event);
        } catch {
          continue;
        }
      }
    }
  }

  private setSessionStatus(
    workspaceId: string,
    sessionID: string,
    status: SessionStatus,
  ): void {
    let statuses = this.sessionStatuses.get(workspaceId);
    if (statuses === undefined) {
      statuses = new Map();
      this.sessionStatuses.set(workspaceId, statuses);
    }
    statuses.set(sessionID, status);
  }
}

import type { SessionStatus } from "@opencode-ai/sdk";
import type { Effect } from "@/lib/omo/adapter/live-adapter-types";
import type { JsonlRecord } from "@/lib/omo/jsonl";
import type { OmoRpcClient } from "@/lib/omo/rpc-client";
import {
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
};

type MergeFromTaskEventEffect = Extract<
  Effect,
  { readonly refreshIndex: true }
>;

export class OmoRegistryDispatcher {
  readonly leafQueue = new Map<string, Promise<void>>();
  private readonly client: OmoRpcClient;
  private readonly refreshIndex: OmoRegistryDispatcherOptions["refreshIndex"];
  private readonly sinks = new Map<string, Set<OmoRegistryEventSink>>();
  // Per-session latest status only (busy/idle/retry) — bounded by session
  // count, unlike the unbounded event log this replaced.
  private readonly sessionStatuses = new Map<
    string,
    Map<string, SessionStatus>
  >();

  constructor(options: OmoRegistryDispatcherOptions) {
    this.client = options.client;
    this.refreshIndex = options.refreshIndex;
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
    if (!this.isMergeEffect(effect)) return;
    binding.effectTail = this.continueEffectTail(binding, async () => {
      await mergeOmoSessionIndexFromTaskEvent(binding.workspaceId, [
        effect.mergeFromTaskEvent,
      ]);
      await this.refreshIndex(binding.workspace);
    });
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
    const row = effect["mergeFromTaskEvent"];
    return (
      isJsonObject(row) &&
      typeof row["durableId"] === "string" &&
      effect["refreshIndex"] === true
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

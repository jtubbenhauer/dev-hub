import type { JsonlRecord } from "@/lib/omo/jsonl";
import type { OmoRpcClient } from "@/lib/omo/rpc-client";
import { getOmoIndexRow } from "@/lib/omo/session-index";
import { OmoAttachCoordinator } from "@/lib/omo/session-registry-aliases";
import { attachOmoSession } from "@/lib/omo/session-registry-attach";
import {
  createOmoOpenedBinding,
  createOmoSuccessorBinding,
  type OmoBindOpenedInput,
} from "@/lib/omo/session-registry-binding";
import { OmoRegistryDispatcher } from "@/lib/omo/session-registry-dispatch";
import { OmoWorkspacePathConflictError } from "@/lib/omo/session-registry-errors";
import { handleOmoSessionReplacement } from "@/lib/omo/session-registry-replacement";
import {
  canonicalWorkspacePath,
  getOmoIndexRowByPath,
  refreshOmoIndexFromHost,
} from "@/lib/omo/session-registry-index";
import { parseOpenedState } from "@/lib/omo/session-registry-records";
import {
  handleOmoLifecycleRecord,
  requestOmoSession,
  type OmoSessionRegistryOptions,
} from "@/lib/omo/session-registry-reopen";
import { receiveOmoBoundRecord } from "@/lib/omo/session-registry-routing";
import type {
  OmoAttachRequest,
  OmoPendingAttach,
  OmoRegistryEvent,
  OmoRegistryEventSink,
  OmoSessionBinding,
  OmoSessionRegistryWorkspace,
} from "@/lib/omo/session-registry-types";

export class OmoSessionRegistry {
  readonly attachCoordinator = new OmoAttachCoordinator();
  readonly openLock = this.attachCoordinator.openLock;
  private readonly byDurableId = new Map<string, OmoSessionBinding>();
  private readonly byRoutingHandle = new Map<string, OmoSessionBinding>();
  private readonly bySessionPath = new Map<string, OmoSessionBinding>();
  private readonly workspaceOwners = new Map<string, string>();
  private readonly generations = new Map<string, number>();
  private readonly refreshes = new Map<string, Promise<void>>();
  private readonly dispatcher: OmoRegistryDispatcher;
  private readonly stopGlobalListener: () => void;
  private readonly getSubscriberCount: (workspaceId: string) => number;

  constructor(
    readonly client: OmoRpcClient,
    options: OmoSessionRegistryOptions = {},
  ) {
    this.dispatcher = new OmoRegistryDispatcher({
      client,
      refreshIndex: (workspace) => this.refreshIndexFromHost(workspace),
    });
    this.getSubscriberCount =
      options.getSubscriberCount ??
      ((workspaceId) => this.dispatcher.subscriberCount(workspaceId));
    this.stopGlobalListener = client.on(this.routeBoundRecord.bind(this));
  }

  get leafQueue(): ReadonlyMap<string, Promise<void>> {
    return this.dispatcher.leafQueue;
  }

  attach(request: OmoAttachRequest): Promise<OmoSessionBinding> {
    return attachOmoSession(this, request);
  }

  request(
    binding: OmoSessionBinding,
    command: JsonlRecord,
  ): Promise<JsonlRecord> {
    return requestOmoSession(this, binding, command);
  }

  create({ workspace }: { readonly workspace: OmoSessionRegistryWorkspace }) {
    return this.attach({ workspace });
  }

  get pendingAttach(): ReadonlyMap<string, OmoPendingAttach> {
    return this.attachCoordinator.pending;
  }

  getIndexRow(workspaceId: string, durableId: string) {
    return getOmoIndexRow(workspaceId, durableId);
  }

  getIndexRowByPath(workspaceId: string, sessionPath: string) {
    return getOmoIndexRowByPath(workspaceId, sessionPath);
  }

  canonicalWorkspacePath(workspace: OmoSessionRegistryWorkspace) {
    return canonicalWorkspacePath(workspace);
  }

  findBinding(
    workspaceId: string,
    durableId: string | undefined,
    sessionPath: string | null,
  ): OmoSessionBinding | undefined {
    const byId = durableId
      ? this.byDurableId.get(this.durableKey(workspaceId, durableId))
      : undefined;
    const path = sessionPath;
    const byPath = path ? this.bySessionPath.get(path) : undefined;
    const binding =
      byId ?? (byPath?.workspaceId === workspaceId ? byPath : undefined);
    return binding?.state === "detached" ? undefined : binding;
  }

  bindOpened(input: OmoBindOpenedInput): OmoSessionBinding {
    const openedState = parseOpenedState(input.opened);
    const durableId = openedState.durableId;
    const generationKey = this.durableKey(
      input.request.workspace.id,
      durableId,
    );
    const generation = (this.generations.get(generationKey) ?? 0) + 1;
    this.generations.set(generationKey, generation);
    const binding = createOmoOpenedBinding({
      openedState,
      routingHandle: input.opened.sessionId,
      buffered: input.buffered,
      overflowed: input.overflowed,
      request: input.request,
      canonicalPath: input.canonicalPath,
      generation,
    });
    binding.unregisterSession = this.client.onSession(
      binding.routingHandle,
      () => undefined,
    );
    this.byDurableId.set(generationKey, binding);
    this.byRoutingHandle.set(binding.routingHandle, binding);
    if (binding.sessionPath !== null) {
      this.bySessionPath.set(binding.sessionPath, binding);
    }
    this.workspaceOwners.set(input.canonicalPath, binding.workspaceId);
    return binding;
  }

  beginReplacement(binding: OmoSessionBinding, error: Error): void {
    binding.state = "replaced";
    binding.failure = error;
    binding.rejectReady(error);
    const key = this.durableKey(binding.workspaceId, binding.durableId);
    this.generations.set(key, binding.generation + 1);
    if (
      binding.sessionPath !== null &&
      this.bySessionPath.get(binding.sessionPath) === binding
    ) {
      this.bySessionPath.delete(binding.sessionPath);
    }
  }

  bindSuccessor(
    previous: OmoSessionBinding,
    durableId: string,
    sessionPath: string,
  ): OmoSessionBinding {
    const key = this.durableKey(previous.workspaceId, durableId);
    const generation = (this.generations.get(key) ?? 0) + 1;
    this.generations.set(key, generation);
    const binding = createOmoSuccessorBinding({
      previous,
      durableId,
      sessionPath,
      generation,
    });
    previous.unregisterSession = () => undefined;
    this.byDurableId.delete(
      this.durableKey(previous.workspaceId, previous.durableId),
    );
    this.byDurableId.set(key, binding);
    this.byRoutingHandle.set(binding.routingHandle, binding);
    this.bySessionPath.set(sessionPath, binding);
    return binding;
  }

  assertWorkspaceAvailable(canonicalPath: string, workspaceId: string): void {
    const owner = this.workspaceOwners.get(canonicalPath);
    if (owner !== undefined && owner !== workspaceId) {
      throw new OmoWorkspacePathConflictError(
        canonicalPath,
        owner,
        workspaceId,
      );
    }
  }

  refreshIndexFromHost(workspace: OmoSessionRegistryWorkspace): Promise<void> {
    const active = this.refreshes.get(workspace.id);
    if (active) return active;
    const refresh = this.canonicalWorkspacePath(workspace)
      .then((path) => refreshOmoIndexFromHost(this.client, workspace, path))
      .finally(() => {
        if (this.refreshes.get(workspace.id) === refresh) {
          this.refreshes.delete(workspace.id);
        }
      });
    this.refreshes.set(workspace.id, refresh);
    return refresh;
  }

  dispatchBoundRecord(
    binding: OmoSessionBinding,
    record: JsonlRecord,
  ): readonly OmoRegistryEvent[] {
    if (record["type"] === "session_replaced") {
      void handleOmoSessionReplacement(this, binding, record).catch((error) => {
        binding.failure =
          error instanceof Error ? error : new Error(String(error));
      });
      return [];
    }
    return this.dispatcher.dispatch(binding, record);
  }

  emitEvent(workspaceId: string, event: OmoRegistryEvent): void {
    this.dispatcher.emitEvent(workspaceId, event);
  }

  bindingsForLifecycle(): readonly OmoSessionBinding[] {
    return [...new Set(this.byDurableId.values())];
  }

  detachBinding(binding: OmoSessionBinding): void {
    if (binding.state === "closed" || binding.state === "replaced") return;
    if (this.byRoutingHandle.get(binding.routingHandle) === binding) {
      this.byRoutingHandle.delete(binding.routingHandle);
    }
    binding.unregisterSession();
    binding.unregisterSession = () => undefined;
    binding.state = "detached";
    binding.failure = undefined;
  }

  isCurrent(binding: OmoSessionBinding): boolean {
    const key = this.durableKey(binding.workspaceId, binding.durableId);
    return (
      binding.state !== "detached" &&
      binding.state !== "replaced" &&
      this.generations.get(key) === binding.generation &&
      this.byDurableId.get(key) === binding
    );
  }

  enqueueLeaf(
    workspaceId: string,
    durableId: string,
    mutation: () => Promise<void>,
  ): Promise<void> {
    return this.dispatcher.enqueueLeaf(workspaceId, durableId, mutation);
  }

  eventsForWorkspace(workspaceId: string): readonly OmoRegistryEvent[] {
    return this.dispatcher.eventsForWorkspace(workspaceId);
  }

  recordsForWorkspace(workspaceId: string): readonly JsonlRecord[] {
    return this.dispatcher.recordsForWorkspace(workspaceId);
  }

  subscribe(workspaceId: string, sink: OmoRegistryEventSink): () => void {
    return this.dispatcher.subscribe(workspaceId, sink);
  }

  subscriberCount(workspaceId: string): number {
    return this.dispatcher.subscriberCount(workspaceId);
  }

  cleanupBinding(binding: OmoSessionBinding): void {
    const key = this.durableKey(binding.workspaceId, binding.durableId);
    if (this.generations.get(key) !== binding.generation) return;
    if (this.byDurableId.get(key) === binding) this.byDurableId.delete(key);
    if (this.byRoutingHandle.get(binding.routingHandle) === binding) {
      this.byRoutingHandle.delete(binding.routingHandle);
    }
    if (
      binding.sessionPath !== null &&
      this.bySessionPath.get(binding.sessionPath) === binding
    ) {
      this.bySessionPath.delete(binding.sessionPath);
    }
    binding.unregisterSession();
    if (binding.state !== "replaced") binding.state = "closed";
    const stillOwned = [...this.byRoutingHandle.values()].some(
      (candidate) =>
        candidate.canonicalWorkspacePath === binding.canonicalWorkspacePath,
    );
    if (!stillOwned)
      this.workspaceOwners.delete(binding.canonicalWorkspacePath);
  }

  dispose(): void {
    this.stopGlobalListener();
    for (const binding of new Set(this.byRoutingHandle.values())) {
      this.cleanupBinding(binding);
    }
    this.attachCoordinator.pending.clear();
    this.dispatcher.clear();
  }

  private durableKey(workspaceId: string, durableId: string): string {
    return `${workspaceId}:${durableId}`;
  }

  private routeBoundRecord(record: JsonlRecord): void {
    const routingHandle = record["sessionId"];
    const binding =
      typeof routingHandle === "string"
        ? this.byRoutingHandle.get(routingHandle)
        : undefined;
    if (
      handleOmoLifecycleRecord({
        registry: this,
        binding,
        record,
        getSubscriberCount: this.getSubscriberCount,
      })
    ) {
      return;
    }
    if (!binding) return;
    receiveOmoBoundRecord(this, binding, record);
  }
}

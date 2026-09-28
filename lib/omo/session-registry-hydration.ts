import { OmoCommandError } from "@/lib/omo/errors";
import type { JsonlRecord } from "@/lib/omo/jsonl";
import type { OmoRpcClient } from "@/lib/omo/rpc-client";
import { setOmoLeaf, type OmoSessionIndexRow } from "@/lib/omo/session-index";
import { OmoHydrationOverflowError } from "@/lib/omo/session-registry-errors";
import { OmoRegistryRecordBuffer } from "@/lib/omo/session-registry-lock";
import {
  activeHydrationBranch,
  adapterSeedForReplay,
  isEntryAncestor,
  parseEntriesSnapshot,
  responseLeafId,
  rootUserEntryId,
  type OmoEntriesSnapshot,
  type OmoOpenedState,
} from "@/lib/omo/session-registry-records";
import type {
  OmoRegistryEvent,
  OmoSessionBinding,
} from "@/lib/omo/session-registry-types";

export type OmoHydrationController = {
  readonly client: OmoRpcClient;
  readonly getIndexRow: (
    workspaceId: string,
    durableId: string,
  ) => Promise<OmoSessionIndexRow | null>;
  readonly isCurrent: (binding: OmoSessionBinding) => boolean;
  readonly dispatchBoundRecord: (
    binding: OmoSessionBinding,
    record: JsonlRecord,
  ) => void;
  readonly emitEvent: (workspaceId: string, event: OmoRegistryEvent) => void;
  readonly enqueueLeaf: (
    workspaceId: string,
    durableId: string,
    mutation: () => Promise<void>,
  ) => Promise<void>;
};

type RestoredSnapshot = {
  readonly snapshot: OmoEntriesSnapshot;
  readonly leafId: string | null;
};

function getEntries(
  client: OmoRpcClient,
  routingHandle: string,
): Promise<JsonlRecord> {
  return client.request({ type: "get_entries", sessionId: routingHandle });
}

async function persistLeaf(
  controller: OmoHydrationController,
  binding: OmoSessionBinding,
  leafId: string | null,
): Promise<void> {
  await controller.enqueueLeaf(binding.workspaceId, binding.durableId, () =>
    setOmoLeaf(binding.workspaceId, binding.durableId, leafId),
  );
}

async function navigate(
  controller: OmoHydrationController,
  binding: OmoSessionBinding,
  entryId: string,
  intent: "resume" | "select",
  expectedLeafId: string | null,
): Promise<string | null> {
  const response = await controller.client.request({
    type: "navigate_tree",
    sessionId: binding.routingHandle,
    entryId,
    intent,
    expectedLeafId,
  });
  return responseLeafId(response);
}

async function restoreAfterStaleLeaf(
  controller: OmoHydrationController,
  binding: OmoSessionBinding,
  opened: OmoOpenedState,
  savedLeaf: string,
): Promise<RestoredSnapshot> {
  const snapshot = parseEntriesSnapshot(
    await getEntries(controller.client, binding.routingHandle),
  );
  if (
    opened.isStreaming ||
    isEntryAncestor(snapshot.entries, savedLeaf, snapshot.leafId)
  ) {
    await persistLeaf(controller, binding, snapshot.leafId);
    return { snapshot, leafId: snapshot.leafId };
  }
  try {
    const leafId = await navigate(
      controller,
      binding,
      savedLeaf,
      "resume",
      snapshot.leafId,
    );
    await persistLeaf(controller, binding, leafId);
    return { snapshot, leafId };
  } catch (error) {
    if (
      !(error instanceof OmoCommandError) ||
      error.errorCode !== "stale_leaf"
    ) {
      throw error;
    }
    const finalSnapshot = parseEntriesSnapshot(
      await getEntries(controller.client, binding.routingHandle),
    );
    await persistLeaf(controller, binding, finalSnapshot.leafId);
    return { snapshot: finalSnapshot, leafId: finalSnapshot.leafId };
  }
}

async function restoreLeaf(
  controller: OmoHydrationController,
  binding: OmoSessionBinding,
  opened: OmoOpenedState,
  row: OmoSessionIndexRow | null,
  snapshot: OmoEntriesSnapshot,
): Promise<RestoredSnapshot> {
  if (row?.leafKnown !== 1 || opened.isStreaming) {
    await persistLeaf(controller, binding, snapshot.leafId);
    return { snapshot, leafId: snapshot.leafId };
  }
  const savedLeaf = row.leafEntryId;
  if (
    savedLeaf !== null &&
    !snapshot.entries.some((entry) => entry.id === savedLeaf)
  ) {
    await persistLeaf(controller, binding, snapshot.leafId);
    return { snapshot, leafId: snapshot.leafId };
  }
  if (savedLeaf === snapshot.leafId) return { snapshot, leafId: savedLeaf };
  const target = savedLeaf ?? rootUserEntryId(snapshot.entries);
  if (target === undefined) {
    await persistLeaf(controller, binding, snapshot.leafId);
    return { snapshot, leafId: snapshot.leafId };
  }
  try {
    const leafId = await navigate(
      controller,
      binding,
      target,
      savedLeaf === null ? "select" : "resume",
      snapshot.leafId,
    );
    await persistLeaf(controller, binding, leafId);
    return { snapshot, leafId };
  } catch (error) {
    if (
      savedLeaf !== null &&
      error instanceof OmoCommandError &&
      error.errorCode === "stale_leaf"
    ) {
      return restoreAfterStaleLeaf(controller, binding, opened, savedLeaf);
    }
    throw error;
  }
}

function replayBuffer(
  controller: OmoHydrationController,
  binding: OmoSessionBinding,
): void {
  while (binding.buffer.size > 0) {
    const records = binding.buffer.drain();
    for (let index = 0; index < records.length; index += 1) {
      if (!controller.isCurrent(binding)) {
        binding.buffer.pushAll(records.slice(index));
        return;
      }
      controller.dispatchBoundRecord(binding, records[index]);
    }
  }
}

async function hydrateAfterOverflow(
  controller: OmoHydrationController,
  binding: OmoSessionBinding,
  opened: OmoOpenedState,
): Promise<void> {
  binding.buffer.clear();
  for (let fence = 2; fence <= 3; fence += 1) {
    let snapshot: OmoEntriesSnapshot | undefined;
    await controller.client.request(
      { type: "get_entries", sessionId: binding.routingHandle },
      {
        onResponse: (response) => {
          snapshot = parseEntriesSnapshot(response);
          const branch = activeHydrationBranch(
            snapshot.entries,
            snapshot.leafId,
          );
          binding.adapter.seed(adapterSeedForReplay(branch, [], opened));
          binding.state = "cutover";
          binding.buffer = new OmoRegistryRecordBuffer();
        },
      },
    );
    if (snapshot === undefined)
      throw new TypeError("Missing OmO hydration fence");
    if (binding.buffer.overflowed) continue;
    replayBuffer(controller, binding);
    if (!controller.isCurrent(binding)) return;
    binding.state = "live";
    binding.resolveReady(binding);
    controller.emitEvent(binding.workspaceId, {
      type: "session.resync_required",
      properties: { sessionID: `omo_${binding.durableId}` },
    });
    return;
  }
  throw new OmoHydrationOverflowError(binding.durableId);
}

export async function hydrateOmoBinding(
  controller: OmoHydrationController,
  binding: OmoSessionBinding,
): Promise<void> {
  const opened = binding.openedState;
  const row = await controller.getIndexRow(
    binding.workspaceId,
    binding.durableId,
  );
  const firstSnapshot = parseEntriesSnapshot(
    await getEntries(controller.client, binding.routingHandle),
  );
  if (!controller.isCurrent(binding)) return;
  const restored = await restoreLeaf(
    controller,
    binding,
    opened,
    row,
    firstSnapshot,
  );
  if (!controller.isCurrent(binding)) return;
  const branch = activeHydrationBranch(
    restored.snapshot.entries,
    restored.leafId,
  );
  const buffered = binding.buffer.drain();
  binding.adapter.seed(adapterSeedForReplay(branch, buffered, opened));
  binding.buffer.pushAll(buffered);
  if (binding.buffer.overflowed) {
    await hydrateAfterOverflow(controller, binding, opened);
    return;
  }
  replayBuffer(controller, binding);
  if (!controller.isCurrent(binding)) return;
  binding.state = "live";
  binding.resolveReady(binding);
}

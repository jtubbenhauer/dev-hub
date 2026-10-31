import { OmoCommandError } from "@/lib/omo/errors";
import type { JsonlRecord } from "@/lib/omo/jsonl";
import type { OmoRpcClient } from "@/lib/omo/rpc-client";
import { requestOmoEntries } from "@/lib/omo/session-entries-request";
import { setOmoLeaf, type OmoSessionIndexRow } from "@/lib/omo/session-index";
import {
  OmoHydrationAbortedError,
  OmoHydrationOverflowError,
} from "@/lib/omo/session-registry-errors";
import { OmoRegistryRecordBuffer } from "@/lib/omo/session-registry-lock";
import {
  activeHydrationBranch,
  adapterSeedForReplay,
  isEntryAncestor,
  parseEntriesSnapshot,
  responseLeafId,
  rootUserEntryId,
  type OmoEntriesSnapshot,
  type OmoHydrationEntry,
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

function abortHydration(binding: OmoSessionBinding): void {
  binding.rejectReady(new OmoHydrationAbortedError(binding.durableId));
}

function getEntries(
  client: OmoRpcClient,
  binding: OmoSessionBinding,
  onResponse?: (response: JsonlRecord) => void,
): Promise<JsonlRecord> {
  return requestOmoEntries({
    send: (command, onCommandResponse) =>
      client.request(
        { ...command, sessionId: binding.routingHandle },
        onCommandResponse ? { onResponse: onCommandResponse } : undefined,
      ),
    durableId: binding.durableId,
    sessionPath: binding.sessionPath,
    onResponse,
  });
}

async function persistLeaf(
  controller: OmoHydrationController,
  binding: OmoSessionBinding,
  leafId: string | null,
  snapshot: OmoEntriesSnapshot,
): Promise<void> {
  await controller.enqueueLeaf(binding.workspaceId, binding.durableId, () =>
    setOmoLeaf(
      binding.workspaceId,
      binding.durableId,
      leafId,
      snapshot.entries.at(-1)?.id ?? null,
    ),
  );
}

function isMessageEntry(entry: OmoHydrationEntry): boolean {
  return entry.type === "message";
}

// omo reopens a session at the newest entry in its file. A leaf that only got
// there, with no conversation dev-hub has not seen, says nothing about where
// the session should be, so dev-hub restores its saved leaf (an undo, say).
// Any other mismatch means omo moved on, or was switched to another branch,
// while dev-hub was not watching.
function hasOmoMovedSinceSave(
  snapshot: OmoEntriesSnapshot,
  savedLeaf: string | null,
  seenThroughEntryId: string | null,
): boolean {
  const omoBranch = activeHydrationBranch(snapshot.entries, snapshot.leafId);
  const savedIndex = omoBranch.findIndex((entry) => entry.id === savedLeaf);
  if (
    savedIndex !== -1 &&
    !omoBranch.slice(savedIndex + 1).some(isMessageEntry)
  ) {
    return true;
  }
  const seenIndex = snapshot.entries.findIndex(
    (entry) => entry.id === seenThroughEntryId,
  );
  // Rows saved before dev-hub recorded the newest entry it had seen.
  if (seenIndex === -1) return savedIndex !== -1;
  const unseenIds = new Set(
    snapshot.entries.slice(seenIndex + 1).map((entry) => entry.id),
  );
  if (
    omoBranch.some((entry) => isMessageEntry(entry) && unseenIds.has(entry.id))
  ) {
    return true;
  }
  return !omoBranch.some((entry) => entry.id === seenThroughEntryId);
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
    await getEntries(controller.client, binding),
  );
  if (
    opened.isStreaming ||
    isEntryAncestor(snapshot.entries, savedLeaf, snapshot.leafId)
  ) {
    await persistLeaf(controller, binding, snapshot.leafId, snapshot);
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
    await persistLeaf(controller, binding, leafId, snapshot);
    return { snapshot, leafId };
  } catch (error) {
    if (
      !(error instanceof OmoCommandError) ||
      error.errorCode !== "stale_leaf"
    ) {
      throw error;
    }
    const finalSnapshot = parseEntriesSnapshot(
      await getEntries(controller.client, binding),
    );
    await persistLeaf(controller, binding, finalSnapshot.leafId, finalSnapshot);
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
    await persistLeaf(controller, binding, snapshot.leafId, snapshot);
    return { snapshot, leafId: snapshot.leafId };
  }
  const savedLeaf = row.leafEntryId;
  if (
    savedLeaf !== null &&
    !snapshot.entries.some((entry) => entry.id === savedLeaf)
  ) {
    await persistLeaf(controller, binding, snapshot.leafId, snapshot);
    return { snapshot, leafId: snapshot.leafId };
  }
  if (savedLeaf === snapshot.leafId) return { snapshot, leafId: savedLeaf };
  if (hasOmoMovedSinceSave(snapshot, savedLeaf, row.leafSeenThroughEntryId)) {
    await persistLeaf(controller, binding, snapshot.leafId, snapshot);
    return { snapshot, leafId: snapshot.leafId };
  }
  const target = savedLeaf ?? rootUserEntryId(snapshot.entries);
  if (target === undefined) {
    await persistLeaf(controller, binding, snapshot.leafId, snapshot);
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
    await persistLeaf(controller, binding, leafId, snapshot);
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
    await getEntries(controller.client, binding, (response) => {
      snapshot = parseEntriesSnapshot(response);
      const branch = activeHydrationBranch(snapshot.entries, snapshot.leafId);
      binding.adapter.seed(adapterSeedForReplay(branch, [], opened));
      binding.state = "cutover";
      binding.buffer = new OmoRegistryRecordBuffer();
    });
    if (snapshot === undefined)
      throw new TypeError("Missing OmO hydration fence");
    if (binding.buffer.overflowed) continue;
    replayBuffer(controller, binding);
    if (!controller.isCurrent(binding)) {
      abortHydration(binding);
      return;
    }
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
    await getEntries(controller.client, binding),
  );
  if (!controller.isCurrent(binding)) {
    abortHydration(binding);
    return;
  }
  const restored = await restoreLeaf(
    controller,
    binding,
    opened,
    row,
    firstSnapshot,
  );
  if (!controller.isCurrent(binding)) {
    abortHydration(binding);
    return;
  }
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
  if (!controller.isCurrent(binding)) {
    abortHydration(binding);
    return;
  }
  binding.state = "live";
  binding.resolveReady(binding);
}

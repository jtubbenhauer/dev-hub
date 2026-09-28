import { buildOmoSession } from "@/lib/omo/adapter/shapes";
import { OmoSessionReplacedError } from "@/lib/omo/session-registry-errors";
import type { JsonlRecord } from "@/lib/omo/jsonl";
import { recordOmoSessionReplacement } from "@/lib/omo/session-index";
import type { OmoSessionRegistry } from "@/lib/omo/session-registry-core";
import { hydrateOmoBinding } from "@/lib/omo/session-registry-hydration";
import type {
  OmoAttachAliases,
  OmoPendingAttach,
  OmoSessionBinding,
} from "@/lib/omo/session-registry-types";

type ReplacementTarget = {
  readonly durableId: string;
  readonly sessionPath: string;
};

type ReplacementOperation = {
  readonly registry: OmoSessionRegistry;
  readonly previous: OmoSessionBinding;
  readonly target: ReplacementTarget;
  readonly aliases: OmoAttachAliases;
};

function replacementTarget(record: JsonlRecord): ReplacementTarget {
  const durableId = record["durableSessionId"];
  const sessionPath = record["sessionFile"];
  if (typeof durableId !== "string" || typeof sessionPath !== "string") {
    throw new TypeError("Invalid OmO session_replaced record");
  }
  return { durableId, sessionPath };
}

async function completeReplacement(
  operation: ReplacementOperation,
): Promise<OmoSessionBinding> {
  const { registry, previous, target, aliases } = operation;
  const oldRow = await registry.getIndexRow(
    previous.workspaceId,
    previous.durableId,
  );
  await recordOmoSessionReplacement(
    previous.workspaceId,
    previous.durableId,
    target.durableId,
    target.sessionPath,
  );
  // Re-key unresolved dialogs here once the runtime injects todo 15's ledger.
  const binding = registry.bindSuccessor(
    previous,
    target.durableId,
    target.sessionPath,
  );
  try {
    await hydrateOmoBinding(registry, binding);
  } catch (error) {
    binding.rejectReady(error);
    registry.cleanupBinding(binding);
    throw error;
  }
  const row = await registry.getIndexRow(
    binding.workspaceId,
    binding.durableId,
  );
  const now = Date.now();
  const oldParentDurableId = oldRow?.parentDurableId ?? null;
  const oldInfo = buildOmoSession({
    rawId: previous.durableId,
    workspaceId: previous.workspaceId,
    directory: previous.workspace.path,
    title: oldRow?.title ?? "Untitled",
    created: oldRow?.createdMs ?? now,
    updated: oldRow?.updatedMs ?? now,
    ...(oldParentDurableId ? { parentRawId: oldParentDurableId } : {}),
  });
  const newParentDurableId = row?.parentDurableId ?? null;
  const newInfo = buildOmoSession({
    rawId: binding.durableId,
    workspaceId: binding.workspaceId,
    directory: binding.workspace.path,
    title: row?.title ?? oldInfo.title,
    created: row?.createdMs ?? now,
    updated: row?.updatedMs ?? now,
    ...(newParentDurableId ? { parentRawId: newParentDurableId } : {}),
  });
  registry.attachCoordinator.delete(aliases);
  registry.emitEvent(binding.workspaceId, {
    type: "session.created",
    properties: { info: newInfo },
  });
  registry.emitEvent(binding.workspaceId, {
    type: "session.deleted",
    properties: { info: oldInfo },
  });
  // TODO(todo 15): Re-key unresolved dialogs before metadata_moved is emitted.
  registry.emitEvent(binding.workspaceId, {
    type: "session.metadata_moved",
    properties: {
      sessionID: newInfo.id,
      fromSessionID: oldInfo.id,
    },
  });
  return binding;
}

export function handleOmoSessionReplacement(
  registry: OmoSessionRegistry,
  binding: OmoSessionBinding,
  record: JsonlRecord,
): Promise<OmoSessionBinding> {
  const target = replacementTarget(record);
  if (binding.state === "replaced") return Promise.reject(binding.failure);
  registry.beginReplacement(
    binding,
    new OmoSessionReplacedError(target.durableId),
  );
  const aliases: OmoAttachAliases = { token: {}, keys: new Set() };
  const promise = completeReplacement({
    registry,
    previous: binding,
    target,
    aliases,
  });
  const pending: OmoPendingAttach = { promise, token: aliases.token };
  registry.attachCoordinator.register(
    registry.attachCoordinator.idKey(binding.workspaceId, target.durableId),
    pending,
    aliases,
  );
  registry.attachCoordinator.register(
    registry.attachCoordinator.pathKey(binding.workspaceId, target.sessionPath),
    pending,
    aliases,
  );
  void promise.then(undefined, () =>
    registry.attachCoordinator.delete(aliases),
  );
  return promise;
}

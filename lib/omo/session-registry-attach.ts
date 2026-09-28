import {
  OmoCorruptIndexRowError,
  OmoSessionReplacedError,
} from "@/lib/omo/session-registry-errors";
import type { JsonlRecord } from "@/lib/omo/jsonl";
import { OmoSessionIdentityConflictError } from "@/lib/omo/session-index-errors";
import {
  getOmoIndexRow,
  readStoredContext,
  touchOmoSessionIndex,
  type OmoSessionIndexRow,
} from "@/lib/omo/session-index";
import type { OmoSessionRegistry } from "@/lib/omo/session-registry-core";
import { hydrateOmoBinding } from "@/lib/omo/session-registry-hydration";
import { parseOpenedState } from "@/lib/omo/session-registry-records";
import type {
  OmoAttachAliases,
  OmoAttachRequest,
  OmoCanonicalAttach,
  OmoPendingAttach,
  OmoSessionBinding,
} from "@/lib/omo/session-registry-types";

async function canonicalize(
  registry: OmoSessionRegistry,
  request: OmoAttachRequest,
): Promise<OmoCanonicalAttach> {
  const row = request.durableId
    ? await registry.getIndexRow(request.workspace.id, request.durableId)
    : request.sessionPath
      ? await registry.getIndexRowByPath(
          request.workspace.id,
          request.sessionPath,
        )
      : null;
  return {
    rawId: request.durableId ?? row?.durableId,
    sessionPath: request.sessionPath ?? row?.sessionPath ?? null,
    row,
  };
}

function readyBinding(binding: OmoSessionBinding): Promise<OmoSessionBinding> {
  if (binding.state === "replaced" && binding.failure) {
    return Promise.reject(binding.failure);
  }
  return binding.state === "live" ? Promise.resolve(binding) : binding.ready;
}

function throwIfBindingReplaced(binding: OmoSessionBinding): void {
  if (binding.state !== "replaced") return;
  if (binding.failure !== undefined) throw binding.failure;
  throw new TypeError("Replaced OmO binding is missing its failure");
}

function throwIfReplaced(row: OmoSessionIndexRow | null): void {
  if (row?.replacedByDurableId) {
    throw new OmoSessionReplacedError(row.replacedByDurableId);
  }
}

async function resolveWorkerRow(
  registry: OmoSessionRegistry,
  request: OmoAttachRequest,
  row: OmoSessionIndexRow | null,
): Promise<OmoSessionIndexRow | null> {
  if (row?.kind !== "worker" || row.contextAuthoritative === 1) return row;
  await registry.refreshIndexFromHost(request.workspace);
  return getOmoIndexRow(request.workspace.id, row.durableId);
}

function openParams(
  request: OmoAttachRequest,
  sessionPath: string | null,
  row: OmoSessionIndexRow | null,
): JsonlRecord {
  let context;
  if (row?.kind === "worker") {
    context = readStoredContext(row);
    if (row.contextAuthoritative !== 1 || context === null) {
      throw new OmoCorruptIndexRowError(request.workspace.id, row.durableId);
    }
  }
  return {
    ...(sessionPath ? { sessionPath } : { cwd: request.workspace.path }),
    retain_on_disconnect: true,
    kind: row?.kind ?? "interactive",
    ...(context ? { context } : {}),
  };
}

async function touchOpenedBinding(
  registry: OmoSessionRegistry,
  binding: OmoSessionBinding,
): Promise<void> {
  const existing = await registry.getIndexRow(
    binding.workspaceId,
    binding.durableId,
  );
  const now = Date.now();
  const title =
    typeof binding.openedState.title === "string" && binding.openedState.title
      ? binding.openedState.title
      : typeof existing?.title === "string"
        ? existing.title
        : "Untitled";
  await touchOmoSessionIndex(
    binding.workspaceId,
    binding.durableId,
    binding.sessionPath,
    {
      title,
      createdMs: existing?.createdMs ?? now,
      updatedMs: existing?.updatedMs ?? 0,
    },
  );
}

async function performAttach(
  registry: OmoSessionRegistry,
  request: OmoAttachRequest,
  canonical: OmoCanonicalAttach,
  entry: OmoPendingAttach,
  aliases: OmoAttachAliases,
): Promise<OmoSessionBinding> {
  let release: (() => void) | undefined;
  let binding: OmoSessionBinding | undefined;
  try {
    release = await registry.openLock.acquire();
    await registry.client.connect();
    let row = canonical.rawId
      ? await registry.getIndexRow(request.workspace.id, canonical.rawId)
      : canonical.row;
    throwIfReplaced(row);
    row = await resolveWorkerRow(registry, request, row);
    throwIfReplaced(row);
    const rawId = canonical.rawId ?? row?.durableId;
    const sessionPath = canonical.sessionPath ?? row?.sessionPath ?? null;
    if (sessionPath) {
      registry.attachCoordinator.register(
        registry.attachCoordinator.pathKey(request.workspace.id, sessionPath),
        entry,
        aliases,
      );
    }
    const existingBinding = registry.findBinding(
      request.workspace.id,
      rawId,
      sessionPath,
    );
    if (existingBinding) {
      release();
      release = undefined;
      return await readyBinding(existingBinding);
    }
    const canonicalPath = await registry.canonicalWorkspacePath(
      request.workspace,
    );
    registry.assertWorkspaceAvailable(canonicalPath, request.workspace.id);
    const params = openParams(request, sessionPath, row);
    await registry.client.openSession(
      params,
      (opened, buffered, overflowed) => {
        const openedState = parseOpenedState(opened);
        if (rawId !== undefined && openedState.durableId !== rawId) {
          throw new OmoSessionIdentityConflictError(
            request.workspace.id,
            rawId,
            sessionPath ?? openedState.sessionPath ?? request.workspace.path,
          );
        }
        binding = registry.bindOpened({
          opened,
          buffered,
          overflowed,
          request,
          canonicalPath,
        });
      },
    );
  } finally {
    release?.();
  }
  if (binding === undefined) {
    throw new TypeError("OmO open_session completed without a binding");
  }
  try {
    const [readyBinding] = await Promise.all([
      binding.ready,
      (async () => {
        throwIfBindingReplaced(binding);
        await touchOpenedBinding(registry, binding);
        throwIfBindingReplaced(binding);
        await hydrateOmoBinding(registry, binding);
        throwIfBindingReplaced(binding);
      })(),
    ]);
    return readyBinding;
  } catch (error) {
    binding.rejectReady(error);
    registry.cleanupBinding(binding);
    throw error;
  }
}

export async function attachOmoSession(
  registry: OmoSessionRegistry,
  request: OmoAttachRequest,
): Promise<OmoSessionBinding> {
  const canonical = await canonicalize(registry, request);
  throwIfReplaced(canonical.row);
  const key = canonical.sessionPath
    ? registry.attachCoordinator.pathKey(
        request.workspace.id,
        canonical.sessionPath,
      )
    : canonical.rawId
      ? registry.attachCoordinator.idKey(request.workspace.id, canonical.rawId)
      : undefined;
  const pending = key ? registry.pendingAttach.get(key) : undefined;
  if (pending) return pending.promise;
  const existingBinding = registry.findBinding(
    request.workspace.id,
    canonical.rawId,
    canonical.sessionPath,
  );
  if (existingBinding) return readyBinding(existingBinding);

  const aliases: OmoAttachAliases = { token: {}, keys: new Set() };
  const pendingEntry: OmoPendingAttach = {
    token: aliases.token,
    promise: Promise.resolve()
      .then(() =>
        performAttach(registry, request, canonical, pendingEntry, aliases),
      )
      .finally(() => registry.attachCoordinator.delete(aliases)),
  };
  if (key) registry.attachCoordinator.register(key, pendingEntry, aliases);
  return pendingEntry.promise;
}

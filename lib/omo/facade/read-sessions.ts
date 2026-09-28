import type { Session, SessionStatus } from "@opencode-ai/sdk";
import { buildOmoSession } from "@/lib/omo/adapter/shapes";
import { isJsonObject } from "@/lib/omo/session-registry-records";
import {
  getOmoChildren,
  getOmoIndexRow,
  listOmoHiddenIds,
  touchOmoSessionIndexMany,
  type OmoSessionIndexRow,
} from "@/lib/omo/session-index";
import type { OmoSessionOnDiskSummary } from "@/lib/omo/sessions-on-disk";
import { isEngineUnavailableError } from "@/lib/omo/facade/read-errors";
import {
  jsonResponse,
  sessionNotFoundResponse,
  type OmoReadContext,
} from "@/lib/omo/facade/read-types";

function sessionFromSummary(
  context: OmoReadContext,
  summary: OmoSessionOnDiskSummary,
): Session {
  return buildOmoSession({
    rawId: summary.durableId,
    workspaceId: context.workspace.id,
    directory: context.workspace.path,
    title: summary.title,
    created: summary.createdMs,
    updated: summary.updatedMs,
  });
}

function sessionFromRow(
  context: OmoReadContext,
  row: OmoSessionIndexRow,
): Session {
  return buildOmoSession({
    rawId: row.durableId,
    workspaceId: context.workspace.id,
    directory: context.workspace.path,
    title: row.title,
    created: row.createdMs,
    updated: row.updatedMs,
    ...(row.parentDurableId === null
      ? {}
      : { parentRawId: row.parentDurableId }),
  });
}

function titleFromState(
  response: Readonly<Record<string, unknown>>,
): string | undefined {
  const data = response["data"];
  return isJsonObject(data) && typeof data["sessionName"] === "string"
    ? data["sessionName"]
    : undefined;
}

// Cwd rule matches refreshOmoIndexFromHost: never index/list a foreign cwd.
function liveSessionIds(
  response: Readonly<Record<string, unknown>>,
  workspacePath: string,
  canonicalPath: string,
): string[] {
  const data = response["data"];
  if (!isJsonObject(data) || !Array.isArray(data["sessions"])) return [];
  return data["sessions"].flatMap((value) => {
    if (!isJsonObject(value) || value["kind"] === "worker") return [];
    const cwd = value["cwd"];
    if (
      typeof cwd !== "string" ||
      (cwd !== workspacePath && cwd !== canonicalPath)
    ) {
      return [];
    }
    const durableId = value["durableSessionId"];
    return typeof durableId === "string" ? [durableId] : [];
  });
}

async function liveSummaries(
  context: OmoReadContext,
): Promise<OmoSessionOnDiskSummary[]> {
  if (!context.runtime.client.isConnected) return [];
  try {
    await context.runtime.registry.refreshIndexFromHost(context.workspace);
    const canonicalPath = await context.runtime.registry.canonicalWorkspacePath(
      context.workspace,
    );
    const response = await context.runtime.client.request({
      type: "list_sessions",
      include_workers: false,
    });
    const summaries: OmoSessionOnDiskSummary[] = [];
    for (const durableId of liveSessionIds(
      response,
      context.workspace.path,
      canonicalPath,
    )) {
      const row = await getOmoIndexRow(context.workspace.id, durableId);
      const now = Date.now();
      summaries.push({
        durableId,
        sessionPath: row?.sessionPath ?? "",
        forkedFrom: null,
        title: row?.title ?? "Untitled",
        createdMs: row?.createdMs ?? now,
        updatedMs: row?.updatedMs ?? now,
      });
    }
    return summaries;
  } catch (error) {
    if (isEngineUnavailableError(error)) return [];
    throw error;
  }
}

export async function listOmoSessions(
  context: OmoReadContext,
): Promise<Response> {
  const disk = await context.source.list();
  const live = await liveSummaries(context);
  const hidden = new Set(await listOmoHiddenIds(context.workspace.id));
  const byId = new Map<string, OmoSessionOnDiskSummary>();
  for (const summary of disk) byId.set(summary.durableId, summary);
  for (const summary of live) {
    if (!byId.has(summary.durableId)) byId.set(summary.durableId, summary);
  }
  const roots = [...byId.values()]
    .filter((summary) => !hidden.has(summary.durableId))
    .sort((left, right) => right.updatedMs - left.updatedMs);
  await touchOmoSessionIndexMany(
    context.workspace.id,
    roots.map((summary) => ({
      durableId: summary.durableId,
      sessionPath: summary.sessionPath || null,
      title: summary.title,
      createdMs: summary.createdMs,
      updatedMs: summary.updatedMs,
    })),
  );
  return jsonResponse(
    roots.map((summary) => sessionFromSummary(context, summary)),
  );
}

export async function readOmoSession(
  context: OmoReadContext,
  rawId: string,
): Promise<Response> {
  const [row, summaries] = await Promise.all([
    getOmoIndexRow(context.workspace.id, rawId),
    context.source.list(),
  ]);
  if (row?.replacedByDurableId != null) return sessionNotFoundResponse();
  const summary = summaries.find((candidate) => candidate.durableId === rawId);
  let session: Session;
  if (summary !== undefined) {
    session = sessionFromSummary(context, summary);
    if (row?.parentDurableId) {
      session = { ...session, parentID: `omo_${row.parentDurableId}` };
    }
  } else if (row !== null) {
    session = sessionFromRow(context, row);
  } else {
    return sessionNotFoundResponse();
  }
  const binding = context.runtime.registry.findBinding(
    context.workspace.id,
    rawId,
    summary?.sessionPath ?? row?.sessionPath ?? null,
  );
  if (binding === undefined) return jsonResponse(session);
  await binding.ready;
  const state = await context.runtime.registry.request(binding, {
    type: "get_state",
  });
  const title = titleFromState(state);
  return jsonResponse(title === undefined ? session : { ...session, title });
}

export async function readOmoChildren(
  context: OmoReadContext,
  rawId: string,
): Promise<Response> {
  const parentRow = await getOmoIndexRow(context.workspace.id, rawId);
  if (parentRow === null && !(await context.source.authorizeSession(rawId))) {
    return sessionNotFoundResponse();
  }
  if (context.runtime.client.isConnected) {
    try {
      await context.runtime.registry.refreshIndexFromHost(context.workspace);
    } catch (error) {
      if (!isEngineUnavailableError(error)) throw error;
    }
  }
  const rows = await getOmoChildren(context.workspace.id, rawId);
  return jsonResponse(rows.map((row) => sessionFromRow(context, row)));
}

function sessionStatusesForWorkspace(
  context: OmoReadContext,
): Record<string, SessionStatus> {
  const statuses: Record<string, SessionStatus> = {};
  for (const binding of context.runtime.registry.bindingsForLifecycle()) {
    if (
      binding.workspaceId === context.workspace.id &&
      binding.state !== "closed" &&
      binding.state !== "replaced"
    ) {
      statuses[`omo_${binding.durableId}`] = {
        type: binding.openedState.isStreaming ? "busy" : "idle",
      };
    }
  }
  return {
    ...statuses,
    ...context.runtime.registry.sessionStatusesForWorkspace(
      context.workspace.id,
    ),
  };
}

export function readOmoSessionStatus(context: OmoReadContext): Response {
  return jsonResponse(sessionStatusesForWorkspace(context));
}

export function readOmoTodos(): Response {
  return jsonResponse([]);
}

export interface OmoSessionStats {
  readonly tokens: {
    readonly input: number;
    readonly output: number;
    readonly cacheRead: number;
    readonly cacheWrite: number;
    readonly total: number;
  };
  readonly cost: number;
  readonly contextUsage: {
    readonly tokens: number;
    readonly contextWindow: number;
    readonly percent: number;
  } | null;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

export function parseOmoSessionStats(
  response: unknown,
): OmoSessionStats | null {
  const data = isJsonObject(response) ? response["data"] : undefined;
  if (!isJsonObject(data)) return null;
  const tokens = data["tokens"];
  const cost = finiteNumber(data["cost"]);
  if (!isJsonObject(tokens) || cost === undefined) return null;
  const input = finiteNumber(tokens["input"]);
  const output = finiteNumber(tokens["output"]);
  const cacheRead = finiteNumber(tokens["cacheRead"]);
  const cacheWrite = finiteNumber(tokens["cacheWrite"]);
  const total = finiteNumber(tokens["total"]);
  if (
    input === undefined ||
    output === undefined ||
    cacheRead === undefined ||
    cacheWrite === undefined ||
    total === undefined
  ) {
    return null;
  }
  const usage = data["contextUsage"];
  const usedTokens = isJsonObject(usage)
    ? finiteNumber(usage["tokens"])
    : undefined;
  const contextWindow = isJsonObject(usage)
    ? finiteNumber(usage["contextWindow"])
    : undefined;
  const percent = isJsonObject(usage)
    ? finiteNumber(usage["percent"])
    : undefined;
  return {
    tokens: { input, output, cacheRead, cacheWrite, total },
    cost,
    contextUsage:
      usedTokens !== undefined &&
      contextWindow !== undefined &&
      contextWindow > 0 &&
      percent !== undefined
        ? { tokens: usedTokens, contextWindow, percent }
        : null,
  };
}

// Stats come from the live daemon session only; a session that is not
// attached returns null rather than being opened just to be measured.
export async function readOmoSessionStats(
  context: OmoReadContext,
  rawId: string,
): Promise<Response> {
  const row = await getOmoIndexRow(context.workspace.id, rawId);
  if (row === null && !(await context.source.authorizeSession(rawId))) {
    return sessionNotFoundResponse();
  }
  const binding = context.runtime.registry.findBinding(
    context.workspace.id,
    rawId,
    row?.sessionPath ?? null,
  );
  if (binding === undefined) return jsonResponse(null);
  await binding.ready;
  const response = await context.runtime.registry.request(binding, {
    type: "get_session_stats",
  });
  return jsonResponse(parseOmoSessionStats(response));
}

import { OmoCommandError } from "@/lib/omo/errors";
import type { OmoOpenedSession } from "@/lib/omo/rpc-client";
import type { OmoRuntime } from "@/lib/omo/session-registry";
import { isJsonObject } from "@/lib/omo/session-registry-records";
import type { SessionSource } from "@/lib/omo/session-source";
import { getCachedCatalog } from "@/lib/omo/adapter/catalog-cache";
import {
  buildCatalog,
  catalogModelKey,
  readCatalogModels,
  readThinkingLevels,
  type OmoCatalog,
  type OmoCatalogModelRow,
} from "@/lib/omo/adapter/catalog-shapes";

export type {
  OmoCatalog,
  OmoCatalogAgent,
  OmoCatalogCommand,
  OmoCatalogMcp,
  OmoCatalogModel,
  OmoCatalogProvider,
  OmoCatalogProviders,
} from "@/lib/omo/adapter/catalog-shapes";

type ProbeIdentity = {
  readonly routingHandle: string;
  readonly rawProbeId: string;
  readonly sessionFile: string | undefined;
};

function isInternalRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function probeIdentity(opened: OmoOpenedSession): ProbeIdentity {
  const state = opened["state"];
  if (!isJsonObject(state) || typeof state["sessionId"] !== "string") {
    throw new TypeError("Invalid OmO catalog probe state");
  }
  const sessionFile = state["sessionFile"];
  if (sessionFile !== undefined && typeof sessionFile !== "string") {
    throw new TypeError("Invalid OmO catalog probe session file");
  }
  return {
    routingHandle: opened.sessionId,
    rawProbeId: state["sessionId"],
    sessionFile,
  };
}

async function openProbe(
  runtime: OmoRuntime,
  workspacePath: string,
): Promise<OmoOpenedSession> {
  const release = await runtime.registry.openLock.acquire();
  try {
    await runtime.client.connect();
    return await runtime.client.openSession(
      {
        cwd: workspacePath,
        kind: "worker",
        retain_on_disconnect: false,
        context: { owner: "dev-hub-probe" },
      },
      () => undefined,
    );
  } finally {
    release();
  }
}

function isRetryableProbeOpen(error: unknown): boolean {
  const errorCode =
    error instanceof OmoCommandError
      ? error.errorCode
      : isInternalRecord(error) && typeof error["errorCode"] === "string"
        ? error["errorCode"]
        : undefined;
  return errorCode === "host_draining" || errorCode === "host_memory_pressure";
}

async function requestThinkingLevels(
  runtime: OmoRuntime,
  routingHandle: string,
  models: readonly OmoCatalogModelRow[],
): Promise<ReadonlyMap<string, readonly string[]>> {
  const missing = models.filter((model) => model.thinkingLevels === undefined);
  if (missing.length === 0) {
    await runtime.client.request({
      type: "get_available_thinking_levels",
      sessionId: routingHandle,
    });
    return new Map();
  }
  const levels = new Map<string, readonly string[]>();
  for (const model of missing) {
    const response = await runtime.client.request({
      type: "get_available_thinking_levels",
      sessionId: routingHandle,
      provider: model.provider,
      modelId: model.id,
    });
    levels.set(
      catalogModelKey(model.provider, model.id),
      readThinkingLevels(response),
    );
  }
  return levels;
}

async function queryProbe(
  runtime: OmoRuntime,
  identity: ProbeIdentity,
): Promise<OmoCatalog> {
  const modelsResponse = await runtime.client.request({
    type: "get_available_models",
    sessionId: identity.routingHandle,
  });
  const models = readCatalogModels(modelsResponse);
  const fallbackThinkingLevels = await requestThinkingLevels(
    runtime,
    identity.routingHandle,
    models,
  );
  const commandsResponse = await runtime.client.request({
    type: "get_commands",
    sessionId: identity.routingHandle,
  });
  const surfacesResponse = await runtime.client.request({
    type: "get_loaded_surfaces",
    sessionId: identity.routingHandle,
  });
  return buildCatalog({
    models,
    fallbackThinkingLevels,
    commandsResponse,
    surfacesResponse,
  });
}

async function closeAndRemoveProbe(
  runtime: OmoRuntime,
  source: SessionSource,
  identity: ProbeIdentity,
): Promise<void> {
  try {
    await runtime.client.request({
      type: "close_session",
      sessionId: identity.routingHandle,
    });
  } finally {
    await source.removeProbeSession(identity.rawProbeId, identity.sessionFile);
  }
}

async function loadCatalog(
  runtime: OmoRuntime,
  workspacePath: string,
  source: SessionSource,
  stale: OmoCatalog | undefined,
): Promise<OmoCatalog> {
  let opened: OmoOpenedSession;
  try {
    opened = await openProbe(runtime, workspacePath);
  } catch (error) {
    if (stale !== undefined && isRetryableProbeOpen(error)) return stale;
    throw error;
  }
  const identity = probeIdentity(opened);
  try {
    return await queryProbe(runtime, identity);
  } finally {
    await closeAndRemoveProbe(runtime, source, identity);
  }
}

export function getCatalog(
  runtime: OmoRuntime,
  workspacePath: string,
  sessionSource: SessionSource,
): Promise<OmoCatalog> {
  return getCachedCatalog(runtime, workspacePath, (stale) =>
    loadCatalog(runtime, workspacePath, sessionSource, stale),
  );
}

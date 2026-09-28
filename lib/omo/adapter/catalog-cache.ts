import type { OmoCatalog } from "@/lib/omo/adapter/catalog-shapes";
import type { OmoRuntime } from "@/lib/omo/session-registry";

const CATALOG_TTL_MS = 5 * 60 * 1_000;
const COORDINATOR_KEY = "\u0000devhub-omo-catalog-coordinator";
const INVALIDATION_EVENTS = new Set([
  "commands_changed",
  "model_changed",
  "loaded_surfaces_changed",
]);

type CatalogCoordinator = {
  readonly kind: "catalog-coordinator";
  version: number;
};

type CatalogCacheEntry = {
  readonly kind: "catalog-cache-entry";
  readonly value: OmoCatalog | undefined;
  readonly expiresAt: number;
  readonly inFlight: Promise<OmoCatalog> | undefined;
  readonly token: object | undefined;
};

function isInternalRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCoordinator(value: unknown): value is CatalogCoordinator {
  return (
    isInternalRecord(value) &&
    value["kind"] === "catalog-coordinator" &&
    typeof value["version"] === "number"
  );
}

function isCacheEntry(value: unknown): value is CatalogCacheEntry {
  return isInternalRecord(value) && value["kind"] === "catalog-cache-entry";
}

function ensureCoordinator(runtime: OmoRuntime): CatalogCoordinator {
  const existing = runtime.catalog.get(COORDINATOR_KEY);
  if (isCoordinator(existing)) return existing;
  const coordinator: CatalogCoordinator = {
    kind: "catalog-coordinator",
    version: 0,
  };
  runtime.catalog.set(COORDINATOR_KEY, coordinator);
  runtime.client.on((record) => {
    if (!INVALIDATION_EVENTS.has(String(record["type"]))) return;
    coordinator.version += 1;
    for (const [key, value] of runtime.catalog) {
      if (key === COORDINATOR_KEY || !isCacheEntry(value)) continue;
      runtime.catalog.set(key, {
        ...value,
        expiresAt: 0,
        inFlight: undefined,
        token: undefined,
      });
    }
  });
  return coordinator;
}

function finishCacheEntry(
  runtime: OmoRuntime,
  workspacePath: string,
  token: object,
  value: OmoCatalog | undefined,
  expiresAt: number,
): void {
  const current = runtime.catalog.get(workspacePath);
  if (!isCacheEntry(current) || current.token !== token) return;
  runtime.catalog.set(workspacePath, {
    kind: "catalog-cache-entry",
    value,
    expiresAt,
    inFlight: undefined,
    token: undefined,
  });
}

export function getCachedCatalog(
  runtime: OmoRuntime,
  workspacePath: string,
  load: (stale: OmoCatalog | undefined) => Promise<OmoCatalog>,
): Promise<OmoCatalog> {
  const coordinator = ensureCoordinator(runtime);
  const cachedValue = runtime.catalog.get(workspacePath);
  const cached = isCacheEntry(cachedValue) ? cachedValue : undefined;
  if (cached?.value !== undefined && cached.expiresAt > Date.now()) {
    return Promise.resolve(cached.value);
  }
  if (cached?.inFlight !== undefined) return cached.inFlight;

  const token = {};
  const version = coordinator.version;
  const inFlight = load(cached?.value).then(
    (value) => {
      finishCacheEntry(
        runtime,
        workspacePath,
        token,
        value,
        coordinator.version === version ? Date.now() + CATALOG_TTL_MS : 0,
      );
      return value;
    },
    (error: unknown) => {
      finishCacheEntry(runtime, workspacePath, token, cached?.value, 0);
      throw error;
    },
  );
  runtime.catalog.set(workspacePath, {
    kind: "catalog-cache-entry",
    value: cached?.value,
    expiresAt: cached?.expiresAt ?? 0,
    inFlight,
    token,
  });
  return inFlight;
}

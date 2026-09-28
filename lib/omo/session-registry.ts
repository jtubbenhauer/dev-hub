import { skillPrefixesFromCache } from "@/lib/omo/adapter/catalog-cache";
import { DialogLedger } from "@/lib/omo/dialog-ledger";
import { OmoRpcClient, UnixSocketTransport } from "@/lib/omo/rpc-client";
import { OmoSessionRegistry } from "@/lib/omo/session-registry-core";

export { OmoEngineUnavailableError } from "@/lib/omo/session-registry-errors";

export type {
  OmoAttachRequest,
  OmoRegistryEvent,
  OmoRegistryEventSink,
  OmoSessionBinding,
  OmoSessionRegistryWorkspace,
} from "@/lib/omo/session-registry-types";

export type OmoDialogLedger = Map<string, unknown>;
export type OmoCatalogCache = Map<string, unknown>;

// Same string as lib/omo/facade/read-runtime.ts's private DIALOG_LEDGER_KEY —
// keep in sync so its magic-key lookup on `dialogs` still finds this ledger.
const DIALOG_LEDGER_MAGIC_KEY = "\u0000devhub-omo-dialog-ledger";

export type OmoRuntime = {
  readonly client: OmoRpcClient;
  readonly registry: OmoSessionRegistry;
  readonly dialogs: OmoDialogLedger;
  readonly catalog: OmoCatalogCache;
  // Typed accessor for the same ledger stored under DIALOG_LEDGER_MAGIC_KEY
  // in `dialogs` above. Optional so callers that build an OmoRuntime without
  // it (e.g. lib/omo/runtime.ts's remote registry) still type-check.
  readonly dialogLedger?: DialogLedger;
};

declare global {
  var __devhubOmo: Map<string, OmoRuntime> | undefined;
}

function createOmoRuntime(hostKey: string): OmoRuntime {
  const client = new OmoRpcClient({
    transport: new UnixSocketTransport({ socketPath: hostKey }),
  });
  const dialogLedger = new DialogLedger();
  const dialogs = new Map<string, unknown>();
  dialogs.set(DIALOG_LEDGER_MAGIC_KEY, dialogLedger);
  const catalog = new Map<string, unknown>();
  const registry = new OmoSessionRegistry(client, {
    dialogLedger,
    getSkillPrefixes: (workspacePath) =>
      skillPrefixesFromCache(catalog, workspacePath),
  });
  return { client, registry, dialogs, catalog, dialogLedger };
}

export function getOmoRuntime(hostKey: string): OmoRuntime {
  const runtimes = globalThis.__devhubOmo ?? new Map<string, OmoRuntime>();
  globalThis.__devhubOmo = runtimes;
  const existing = runtimes.get(hostKey);
  if (existing) return existing;
  const runtime = createOmoRuntime(hostKey);
  runtimes.set(hostKey, runtime);
  return runtime;
}

export function disposeOmoRuntime(hostKey: string): void {
  const runtimes = globalThis.__devhubOmo;
  const runtime = runtimes?.get(hostKey);
  if (!runtime) return;
  runtime.registry.dispose();
  runtime.client.close();
  runtime.dialogs.clear();
  runtime.catalog.clear();
  runtimes?.delete(hostKey);
  if (runtimes?.size === 0) globalThis.__devhubOmo = undefined;
}

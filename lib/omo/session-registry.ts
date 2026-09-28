import { OmoRpcClient, UnixSocketTransport } from "@/lib/omo/rpc-client";
import { OmoSessionRegistry } from "@/lib/omo/session-registry-core";

export type {
  OmoAttachRequest,
  OmoRegistryEvent,
  OmoRegistryEventSink,
  OmoSessionBinding,
  OmoSessionRegistryWorkspace,
} from "@/lib/omo/session-registry-types";

export type OmoDialogLedger = Map<string, unknown>;
export type OmoCatalogCache = Map<string, unknown>;

export type OmoRuntime = {
  readonly client: OmoRpcClient;
  readonly registry: OmoSessionRegistry;
  readonly dialogs: OmoDialogLedger;
  readonly catalog: OmoCatalogCache;
};

declare global {
  var __devhubOmo: Map<string, OmoRuntime> | undefined;
}

function createOmoRuntime(hostKey: string): OmoRuntime {
  const client = new OmoRpcClient({
    transport: new UnixSocketTransport({ socketPath: hostKey }),
  });
  return {
    client,
    registry: new OmoSessionRegistry(client),
    dialogs: new Map(),
    catalog: new Map(),
  };
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

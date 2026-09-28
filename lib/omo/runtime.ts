import { resolveOmoAgentDir, resolveOmoSocketPath } from "@/lib/omo/agent-dir";
import { ensureOmoDaemon } from "@/lib/omo/daemon";
import { OmoTransportGoneError } from "@/lib/omo/errors";
import { RemoteAgentSessionSource } from "@/lib/omo/remote-session-source";
import { OmoRpcClient, WebSocketTransport } from "@/lib/omo/rpc-client";
import { getOmoRuntime, type OmoRuntime } from "@/lib/omo/session-registry";
import { OmoSessionRegistry } from "@/lib/omo/session-registry-core";
import type { OmoSessionRegistryWorkspace } from "@/lib/omo/session-registry-types";
import {
  LocalFsSessionSource,
  type SessionSource,
} from "@/lib/omo/session-source";
import { isTrustedAgentOrigin } from "@/lib/workspaces/agent-origin";
import { RemoteBackend } from "@/lib/workspaces/backend";

export type OmoRuntimeWorkspace = OmoSessionRegistryWorkspace & {
  readonly backend?: "local" | "remote";
  readonly agentUrl?: string | null;
};

export type OmoRuntimeContext = {
  readonly runtime: OmoRuntime;
  readonly source: SessionSource;
};

class RemoteOmoSessionRegistry extends OmoSessionRegistry {
  constructor(
    client: OmoRpcClient,
    private readonly source: RemoteAgentSessionSource,
  ) {
    super(client);
  }

  override canonicalWorkspacePath(
    _workspace: OmoSessionRegistryWorkspace,
  ): Promise<string> {
    return this.source.canonicalWorkspacePath();
  }
}

function getRemoteOmoRuntime(
  hostKey: string,
  token: string,
  source: RemoteAgentSessionSource,
): OmoRuntime {
  const runtimes = globalThis.__devhubOmo ?? new Map<string, OmoRuntime>();
  globalThis.__devhubOmo = runtimes;
  const existing = runtimes.get(hostKey);
  if (existing !== undefined) return existing;
  const client = new OmoRpcClient({
    transport: new WebSocketTransport({ url: hostKey, token }),
  });
  const registry = new RemoteOmoSessionRegistry(client, source);
  const runtime: OmoRuntime = {
    client,
    registry,
    dialogs: new Map(),
    catalog: new Map(),
    dialogLedger: registry.dialogLedger,
  };
  runtimes.set(hostKey, runtime);
  return runtime;
}

export function getOmoRuntimeForWorkspace(
  workspace: OmoRuntimeWorkspace,
  token = process.env.DEVHUB_AGENT_TOKEN ?? "",
): OmoRuntimeContext {
  if (workspace.backend !== "remote") {
    const agentDir = resolveOmoAgentDir();
    return {
      runtime: getOmoRuntime(resolveOmoSocketPath(agentDir)),
      source: new LocalFsSessionSource({
        agentDir,
        workspacePath: workspace.path,
      }),
    };
  }
  if (!workspace.agentUrl) throw new OmoTransportGoneError();
  // The shared agent token must never reach a user-editable, untrusted origin.
  if (!isTrustedAgentOrigin(workspace.agentUrl)) {
    throw new OmoTransportGoneError();
  }
  const backend = new RemoteBackend(workspace.agentUrl, "");
  const source = new RemoteAgentSessionSource({
    sessionsUrl: backend.getOmoSessionsUrl(),
    token,
  });
  const hostKey = backend.getOmoRpcUrl();
  return {
    runtime: getRemoteOmoRuntime(hostKey, token, source),
    source,
  };
}

// Security: the only entry point facade contexts may use to resolve a
// workspace's runtime/source pair, so a remote workspace never falls back
// to the local unix socket and filesystem.
export const createOmoContext = getOmoRuntimeForWorkspace;

export async function ensureOmoConnectionIfNeeded(
  workspace: Pick<OmoRuntimeWorkspace, "backend">,
  runtime: OmoRuntime,
): Promise<void> {
  if (workspace.backend === "remote") return;
  if (runtime.client.isConnected) return;
  await ensureOmoDaemon().catch(() => undefined);
}

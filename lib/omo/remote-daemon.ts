import { OmoTransportGoneError } from "@/lib/omo/errors";
import { retryAutoSuspendRequest } from "@/lib/workspaces/auto-suspend-retry";
import type { Workspace } from "@/types";

const REMOTE_DAEMON_RETRY_DELAYS_MS = [2_000] as const;
const REMOTE_DAEMON_REQUESTS = {
  ensure: { method: "POST", path: "/omo/daemon/ensure" },
  status: { method: "GET", path: "/omo/daemon/status" },
} as const;

type RemoteDaemonOperation = keyof typeof REMOTE_DAEMON_REQUESTS;

type RemoteDaemonRequestOptions = {
  readonly workspace: Workspace;
  readonly userId: string;
  readonly operation: RemoteDaemonOperation;
};

export async function requestRemoteOmoDaemon(
  options: RemoteDaemonRequestOptions,
): Promise<Response> {
  const { workspace, userId, operation } = options;
  const agentUrl = workspace.agentUrl;
  if (workspace.backend !== "remote" || !agentUrl) {
    throw new OmoTransportGoneError();
  }

  const requestConfig = REMOTE_DAEMON_REQUESTS[operation];
  const request = (): Promise<Response> =>
    globalThis.fetch(new URL(requestConfig.path, agentUrl).toString(), {
      method: requestConfig.method,
      headers: {
        Authorization: `Bearer ${process.env.DEVHUB_AGENT_TOKEN ?? ""}`,
      },
      signal: AbortSignal.timeout(10_000),
    });

  const response = await request();
  if (response.status !== 503) return response;

  return (
    (await retryAutoSuspendRequest({
      workspace,
      userId,
      delaysMs: REMOTE_DAEMON_RETRY_DELAYS_MS,
      request,
    })) ?? response
  );
}

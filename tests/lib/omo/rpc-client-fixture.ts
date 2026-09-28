import type { JsonlRecord } from "@/lib/omo/jsonl";
import { afterEach } from "vitest";
import { OmoRpcClient, UnixSocketTransport } from "@/lib/omo/rpc-client";
import {
  startFakeOmoHost,
  type FakeOmoFixture,
  type FakeOmoHost,
} from "@/tests/helpers/omo-fake-host";

export const CLIENT_CAPABILITIES = [
  "extension_events",
  "question",
  "auto_title_sessions",
] as const;

export const REQUIRED_HOST_CAPABILITIES = [
  "multi_session",
  "retain_on_disconnect",
  "session_kind",
  "session_context",
  "extension_events",
] as const;

type HostOptions = {
  readonly fixtures?: readonly FakeOmoFixture[];
  readonly protocolInfo?: JsonlRecord;
};

const hosts: FakeOmoHost[] = [];
const clients: OmoRpcClient[] = [];

export async function createHost(
  options: HostOptions = {},
): Promise<FakeOmoHost> {
  const host = await startFakeOmoHost({
    fixtures: options.fixtures ?? [],
    ...(options.protocolInfo ? { protocolInfo: options.protocolInfo } : {}),
  });
  hosts.push(host);
  return host;
}

export function createClient(host: FakeOmoHost): OmoRpcClient {
  const client = new OmoRpcClient({
    transport: new UnixSocketTransport({ socketPath: host.socketPath }),
  });
  clients.push(client);
  return client;
}

export function pendingRequestCount(client: OmoRpcClient): number {
  const pendingRequests: unknown = Reflect.get(client, "pendingRequests");
  if (!(pendingRequests instanceof Map)) {
    throw new TypeError("OmoRpcClient pendingRequests is not a Map");
  }
  return pendingRequests.size;
}

afterEach(async () => {
  for (const client of clients.splice(0)) client.close();
  for (const host of hosts.splice(0)) await host.close();
});

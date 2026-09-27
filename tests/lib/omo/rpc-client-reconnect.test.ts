// @vitest-environment node

import type { JsonlRecord } from "@/lib/omo/jsonl";
import type { OmoRpcClient } from "@/lib/omo/rpc-client";
import type { FakeOmoConnection } from "@/tests/helpers/omo-fake-host";
import {
  createClient,
  createHost,
  pendingRequestCount,
} from "@/tests/lib/omo/rpc-client-fixture";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const realSetImmediate = globalThis.setImmediate;

function waitForEvent(
  client: OmoRpcClient,
  type: string,
): Promise<JsonlRecord> {
  return new Promise((resolve) => {
    const stop = client.on((record) => {
      if (record["type"] !== type) return;
      stop();
      resolve(record);
    });
  });
}

async function waitForPendingRequestsToClear(
  client: OmoRpcClient,
): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (pendingRequestCount(client) === 0) return;
    await new Promise<void>((resolve) => realSetImmediate(resolve));
  }
  expect(pendingRequestCount(client)).toBe(0);
}

async function advanceHealthyIntervals(
  client: OmoRpcClient,
  connection: FakeOmoConnection,
  count: number,
): Promise<void> {
  for (let interval = 0; interval < count; interval += 1) {
    const nextRecordCount = connection.records.length + 1;
    await vi.advanceTimersByTimeAsync(30_000);
    await connection.waitForRecordCount(nextRecordCount);
    await waitForPendingRequestsToClear(client);
  }
}

describe("OmoRpcClient reconnect supervision", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    vi.stubEnv("OMO_IDLE_DISCONNECT_MS", "600000");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("rejects pending requests, notifies every listener, and backs off repeated drops", async () => {
    const host = await createHost();
    const client = createClient(host);
    const initialConnected = waitForEvent(client, "__devhub_connected");
    const protocolInfo = await client.connect();

    await expect(initialConnected).resolves.toMatchObject({
      type: "__devhub_connected",
      protocolInfo,
    });
    const genericRecords: JsonlRecord[] = [];
    const firstSessionRecords: JsonlRecord[] = [];
    const secondSessionRecords: JsonlRecord[] = [];
    client.on((record) => genericRecords.push(record));
    client.onSession("first", (record) => firstSessionRecords.push(record));
    client.onSession("second", (record) => secondSessionRecords.push(record));
    const firstConnection = host.connections[0];
    expect(firstConnection).toBeDefined();
    firstConnection?.socket.pause();
    const pending = client.request({ type: "blocked_request" });
    const pendingRejection = expect(pending).rejects.toMatchObject({
      name: "OmoTransportGoneError",
    });
    const firstReconnect = waitForEvent(client, "__devhub_connected");

    host.dropAll();
    await pendingRejection;
    await new Promise<void>((resolve) => realSetImmediate(resolve));

    expect(genericRecords).toContainEqual({ type: "__devhub_disconnected" });
    expect(firstSessionRecords).toContainEqual({
      type: "__devhub_disconnected",
    });
    expect(secondSessionRecords).toContainEqual({
      type: "__devhub_disconnected",
    });
    await vi.advanceTimersByTimeAsync(999);
    expect(host.connections).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await firstReconnect;
    expect(host.connections).toHaveLength(2);

    const secondReconnect = waitForEvent(client, "__devhub_connected");
    host.dropAll();
    await new Promise<void>((resolve) => realSetImmediate(resolve));
    await vi.advanceTimersByTimeAsync(1_999);
    expect(host.connections).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    await secondReconnect;
    expect(host.connections).toHaveLength(3);
  });

  it("drains a superseded host until it closes, then reconnects immediately", async () => {
    const host = await createHost();
    const client = createClient(host);
    await client.connect();
    const supersededEvent = waitForEvent(client, "host_superseded");

    host.emit({ type: "host_superseded" });
    await supersededEvent;

    expect(client.superseded).toBe(true);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(host.connections).toHaveLength(1);
    const reconnected = waitForEvent(client, "__devhub_connected");
    host.dropAll();
    await reconnected;
    expect(host.connections).toHaveLength(2);
    expect(client.superseded).toBe(false);
  });

  it("forces a reconnect after three consecutive health failures", async () => {
    const host = await createHost();
    const client = createClient(host);
    await client.connect();
    const connection = host.connections[0];
    expect(connection).toBeDefined();
    connection?.socket.pause();
    const disconnected = waitForEvent(client, "__devhub_disconnected");
    const reconnected = waitForEvent(client, "__devhub_connected");

    await vi.advanceTimersByTimeAsync(95_000);
    await disconnected;
    expect(host.connections).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1_000);
    await reconnected;

    expect(host.connections).toHaveLength(2);
  });

  it("disconnects when idle and reconnects lazily for the next request", async () => {
    const host = await createHost();
    const client = createClient(host);
    await client.connect();
    const connection = host.connections[0];
    expect(connection).toBeDefined();
    if (connection === undefined) return;

    await advanceHealthyIntervals(client, connection, 20);
    await vi.advanceTimersByTimeAsync(30_000);

    expect(client.state).toBe("idle");
    expect(connection.socket.destroyed).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    const reconnected = waitForEvent(client, "__devhub_connected");
    const response = client.request({ type: "list_sessions" });
    await reconnected;

    await expect(response).resolves.toMatchObject({ success: true });
    expect(client.state).toBe("connected");
    expect(host.connections).toHaveLength(2);
  });

  it("stays connected while an operation is in flight", async () => {
    const host = await createHost();
    const client = createClient(host);
    await client.connect();
    const connection = host.connections[0];
    expect(connection).toBeDefined();
    if (connection === undefined) return;
    client.beginOp();

    await advanceHealthyIntervals(client, connection, 21);

    expect(client.state).toBe("connected");
    expect(connection.socket.destroyed).toBe(false);
    client.endOp();
  });

  it("stays connected while a caller holds a subscription", async () => {
    const host = await createHost();
    const client = createClient(host);
    await client.connect();
    const connection = host.connections[0];
    expect(connection).toBeDefined();
    if (connection === undefined) return;
    client.beginSubscription();

    await advanceHealthyIntervals(client, connection, 21);

    expect(client.state).toBe("connected");
    expect(connection.socket.destroyed).toBe(false);
    client.endSubscription();
  });
});

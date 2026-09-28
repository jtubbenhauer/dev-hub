import type { JsonlRecord } from "@/lib/omo/jsonl";
import { describe, expect, it } from "vitest";
import { createClient, createHost } from "@/tests/lib/omo/rpc-client-fixture";

describe("OmoRpcClient session routing", () => {
  it("hands pre-response records to onBound without generic dispatch", async () => {
    const host = await createHost();
    const client = createClient(host);
    await client.connect();
    host.preResponseEvents(3);
    const genericRecords: JsonlRecord[] = [];
    client.on((record) => genericRecords.push(record));
    let bufferedRecords: readonly JsonlRecord[] = [];
    let overflowed = true;

    const opened = await client.openSession(
      {},
      (session, records, didOverflow) => {
        bufferedRecords = records;
        overflowed = didOverflow;
        client.onSession(session.sessionId, () => undefined);
      },
    );

    expect(opened.sessionId).toBe("fake-session-1");
    expect(bufferedRecords).toHaveLength(3);
    expect(bufferedRecords.map((record) => record["index"])).toEqual([0, 1, 2]);
    expect(overflowed).toBe(false);
    expect(genericRecords).toEqual([]);
  });

  it("drops the oldest pre-bind records above the 512-record cap", async () => {
    const host = await createHost();
    const client = createClient(host);
    await client.connect();
    host.preResponseEvents(600);
    let bufferedRecords: readonly JsonlRecord[] = [];
    let overflowed = false;

    await client.openSession({}, (session, records, didOverflow) => {
      bufferedRecords = records;
      overflowed = didOverflow;
      client.onSession(session.sessionId, () => undefined);
    });

    expect(bufferedRecords).toHaveLength(512);
    expect(bufferedRecords[0]?.["index"]).toBe(88);
    expect(bufferedRecords[511]?.["index"]).toBe(599);
    expect(overflowed).toBe(true);
  });

  it("drops the oldest pre-bind records above the one MiB cap", async () => {
    const host = await createHost();
    const client = createClient(host);
    await client.connect();
    let stopBarrierListener: (() => void) | undefined;
    const barrier = new Promise<void>((resolve) => {
      stopBarrierListener = client.on((record) => {
        if (record["type"] === "barrier") resolve();
      });
    });
    const payload = "x".repeat(600_000);

    host.emit({
      type: "large_pre_response",
      sessionId: "fake-session-1",
      sequence: 1,
      payload,
    });
    host.emit({
      type: "large_pre_response",
      sessionId: "fake-session-1",
      sequence: 2,
      payload,
    });
    host.emit({ type: "barrier" });
    await barrier;
    stopBarrierListener?.();
    let bufferedRecords: readonly JsonlRecord[] = [];
    let overflowed = false;

    await client.openSession({}, (session, records, didOverflow) => {
      bufferedRecords = records;
      overflowed = didOverflow;
      client.onSession(session.sessionId, () => undefined);
    });

    expect(bufferedRecords).toHaveLength(1);
    expect(bufferedRecords[0]?.["sequence"]).toBe(2);
    expect(overflowed).toBe(true);
  });

  it("routes tagged records to generic and bound-session listeners", async () => {
    const host = await createHost();
    const client = createClient(host);
    await client.connect();
    const genericRecords: JsonlRecord[] = [];
    const sessionRecords: JsonlRecord[] = [];
    client.on((record) => genericRecords.push(record));
    const sessionRecord = new Promise<void>((resolve) => {
      client.onSession("bound-session", (record) => {
        sessionRecords.push(record);
        resolve();
      });
    });

    host.emit({ type: "bound_event", sessionId: "bound-session" });
    await sessionRecord;

    expect(genericRecords).toEqual([
      { type: "bound_event", sessionId: "bound-session" },
    ]);
    expect(sessionRecords).toEqual(genericRecords);
  });

  it("tracks listeners and in-flight operations", async () => {
    const host = await createHost();
    const client = createClient(host);
    const stopGeneric = client.on(() => undefined);
    const stopSession = client.onSession("session", () => undefined);

    client.beginOp();
    expect(client.listenerCount()).toBe(2);
    expect(client.inFlightOps).toBe(1);

    stopGeneric();
    stopSession();
    client.endOp();
    expect(client.listenerCount()).toBe(0);
    expect(client.inFlightOps).toBe(0);
  });
});

import type { JsonlRecord } from "@/lib/omo/jsonl";
import type { OmoRpcClient } from "@/lib/omo/rpc-client";
import type { FakeOmoHost } from "@/tests/helpers/omo-fake-host";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient, createHost } from "@/tests/lib/omo/rpc-client-fixture";

const ROUTE = "route-1";
const TIMED_OUT = new Error("Timed out waiting for OmO response");

type SessionRecord = JsonlRecord & {
  readonly type: string;
  readonly sessionId: string;
};

function nextSessionRecord(
  client: OmoRpcClient,
  record: SessionRecord,
): Promise<void> {
  return new Promise((resolve) => {
    const stop = client.onSession(record.sessionId, (received) => {
      if (received["type"] !== record.type) return;
      stop();
      resolve();
    });
  });
}

async function emitToSession(
  host: FakeOmoHost,
  client: OmoRpcClient,
  record: SessionRecord,
): Promise<void> {
  const received = nextSessionRecord(client, record);
  host.emit(record);
  await received;
}

async function startUnansweredRequest(type: string) {
  const host = await createHost();
  const client = createClient(host);
  await client.connect();
  const connection = await host.waitForConnection();
  connection.socket.pause();
  const outcome: { settled: unknown } = { settled: "pending" };
  void client.request({ type, sessionId: ROUTE, message: "hello" }).then(
    () => {
      outcome.settled = "answered";
    },
    (error: unknown) => {
      outcome.settled = error;
    },
  );
  return { host, client, outcome };
}

describe("OmoRpcClient deadlines for answers held behind compaction", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each(["prompt", "compact"])(
    "keeps waiting for a %s while its session compacts",
    async (type) => {
      const { host, client, outcome } = await startUnansweredRequest(type);

      await emitToSession(host, client, {
        type: "compaction_start",
        sessionId: ROUTE,
        reason: "pre_prompt",
        requestId: "compaction-1",
      });
      await vi.advanceTimersByTimeAsync(40 * 60_000);
      const whileCompacting = outcome.settled;
      await emitToSession(host, client, {
        type: "compaction_end",
        sessionId: ROUTE,
        reason: "pre_prompt",
        requestId: "compaction-1",
        result: null,
        aborted: false,
        willRetry: false,
      });
      await vi.advanceTimersByTimeAsync(30_000);

      expect(whileCompacting).toBe("pending");
      expect(outcome.settled).toEqual(TIMED_OUT);
    },
  );

  it("gives a prompt omo acknowledged five minutes to be accepted", async () => {
    const { host, client, outcome } = await startUnansweredRequest("prompt");

    const marker = nextSessionRecord(client, {
      type: "marker",
      sessionId: ROUTE,
    });
    host.emit({ type: "queued", for_request: "dh-3", position: 2 });
    host.emit({ type: "marker", sessionId: ROUTE });
    await marker;
    await vi.advanceTimersByTimeAsync(4 * 60_000);
    const beforeDeadline = outcome.settled;
    await vi.advanceTimersByTimeAsync(60_000);

    expect(beforeDeadline).toBe("pending");
    expect(outcome.settled).toEqual(TIMED_OUT);
  });

  it("does not extend a prompt for another session's compaction", async () => {
    const { host, client, outcome } = await startUnansweredRequest("prompt");

    await emitToSession(host, client, {
      type: "compaction_start",
      sessionId: "route-2",
      reason: "threshold",
      requestId: "compaction-2",
    });
    await vi.advanceTimersByTimeAsync(30_000);

    expect(outcome.settled).toEqual(TIMED_OUT);
  });

  it("never waits more than 46 minutes for a prompt across compactions", async () => {
    const { host, client, outcome } = await startUnansweredRequest("prompt");

    await emitToSession(host, client, {
      type: "compaction_start",
      sessionId: ROUTE,
      requestId: "compaction-1",
    });
    await vi.advanceTimersByTimeAsync(45 * 60_000);
    await emitToSession(host, client, {
      type: "compaction_end",
      sessionId: ROUTE,
      requestId: "compaction-1",
      result: null,
      aborted: true,
    });
    await emitToSession(host, client, {
      type: "compaction_start",
      sessionId: ROUTE,
      requestId: "compaction-2",
    });
    const beforeCap = outcome.settled;
    await vi.advanceTimersByTimeAsync(60_001);

    expect(beforeCap).toBe("pending");
    expect(outcome.settled).toEqual(TIMED_OUT);
  });
});

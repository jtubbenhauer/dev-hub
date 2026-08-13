// @vitest-environment node

import { getEventListeners, setMaxListeners } from "node:events";
import {
  superviseSseTarget,
  type SseSupervisorState,
} from "@/lib/opencode/sse-supervisor";
import { describe, expect, it, vi } from "vitest";

function finiteStream(data: string): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`data: ${data}\n\n`));
        controller.close();
      },
    }),
    { status: 200 },
  );
}

function openStream(data: string): {
  readonly response: Response;
  readonly close: () => void;
} {
  let streamController: ReadableStreamDefaultController<Uint8Array> | null =
    null;
  const response = new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller;
        controller.enqueue(new TextEncoder().encode(`data: ${data}\n\n`));
      },
    }),
    { status: 200 },
  );
  return {
    response,
    close: () => streamController?.close(),
  };
}

class StopRetryingError extends Error {
  readonly name = "StopRetryingError";
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error("condition not reached");
}

describe("superviseSseTarget", () => {
  it("reconnects a failed target without reconnecting a healthy sibling", async () => {
    const abortController = new AbortController();
    const aSecond = openStream("a-2");
    const bFirst = openStream("b-1");
    const connectA = vi
      .fn<(signal: AbortSignal) => Promise<Response>>()
      .mockResolvedValueOnce(finiteStream("a-1"))
      .mockResolvedValueOnce(aSecond.response);
    const connectB = vi
      .fn<(signal: AbortSignal) => Promise<Response>>()
      .mockResolvedValueOnce(bFirst.response);
    const events: string[] = [];
    const statesA: SseSupervisorState[] = [];

    const superviseA = superviseSseTarget({
      signal: abortController.signal,
      connect: connectA,
      onData: (data) => events.push(data),
      onState: (state) => statesA.push(state),
      wait: async () => {},
    });
    const superviseB = superviseSseTarget({
      signal: abortController.signal,
      connect: connectB,
      onData: (data) => events.push(data),
      onState: () => {},
      wait: async () => {},
    });

    await waitFor(() => events.includes("a-2") && events.includes("b-1"));
    abortController.abort();
    await Promise.all([superviseA, superviseB]);

    expect(connectA).toHaveBeenCalledTimes(2);
    expect(connectB).toHaveBeenCalledTimes(1);
    expect(statesA.map((state) => state.state)).toEqual([
      "connected",
      "retrying",
      "connected",
    ]);
  });

  it("stops retrying when the downstream request is cancelled", async () => {
    const abortController = new AbortController();
    const connect = vi.fn(async () => finiteStream("once"));
    const wait = vi.fn(async (_delayMs: number, signal: AbortSignal) => {
      abortController.abort();
      if (signal.aborted) return;
    });

    await superviseSseTarget({
      signal: abortController.signal,
      connect,
      onData: () => {},
      onState: () => {},
      wait,
    });

    expect(connect).toHaveBeenCalledTimes(1);
    expect(wait).toHaveBeenCalledTimes(1);
  });

  it("handles a rejected upstream cancellation when the downstream aborts", async () => {
    const abortController = new AbortController();
    const cancellationError = new DOMException(
      "This operation was aborted",
      "AbortError",
    );
    const response = new Response(
      new ReadableStream<Uint8Array>({
        cancel: () => Promise.reject(cancellationError),
      }),
    );
    const unhandledRejections: unknown[] = [];
    const handleUnhandledRejection = (error: unknown) => {
      unhandledRejections.push(error);
    };
    process.on("unhandledRejection", handleUnhandledRejection);

    try {
      const supervision = superviseSseTarget({
        signal: abortController.signal,
        connect: async () => response,
        onData: () => {},
        onState: () => setImmediate(() => abortController.abort()),
      });

      await supervision;
      await new Promise((resolve) => setImmediate(resolve));

      expect(unhandledRejections).toEqual([]);
    } finally {
      process.removeListener("unhandledRejection", handleUnhandledRejection);
    }
  });

  it("does not retain fetch-owned abort listeners across reconnect attempts", async () => {
    const requestAbortController = new AbortController();
    setMaxListeners(0, requestAbortController.signal);
    const stopRetryingError = new StopRetryingError();
    let connectionAttempts = 0;

    const supervision = superviseSseTarget({
      signal: requestAbortController.signal,
      connect: async (signal) => {
        signal.addEventListener("abort", () => {}, { once: true });
        connectionAttempts += 1;
        return finiteStream("event");
      },
      onData: () => {},
      onState: () => {},
      wait: async () => {
        if (connectionAttempts >= 100) throw stopRetryingError;
      },
    });

    await expect(supervision).rejects.toBe(stopRetryingError);
    expect(getEventListeners(requestAbortController.signal, "abort")).toEqual(
      [],
    );
  });
});

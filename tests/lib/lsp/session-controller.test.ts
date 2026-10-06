import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";
import type { LspSessionHandle } from "@/lib/lsp/client/lsp-session";
import {
  createLspSessionController,
  type LspSessionController,
  type LspSessionInputs,
  type LspSessionWorkspace,
} from "@/lib/lsp/client/session-controller";
import type { LspStatusResponse } from "@/lib/lsp/types";
import { useLspStore } from "@/stores/lsp-store";

interface ConnectOptions {
  readonly wsUrl: string;
  readonly workspaceId: string;
  readonly workspaceRoot: string;
  readonly onUnexpectedClose: (code: number, reason: string) => void;
}

interface FakeHandle extends LspSessionHandle {
  readonly dispose: Mock<() => void>;
}

const initialLspState = useLspStore.getState();
const workspaceA: LspSessionWorkspace = {
  id: "ws-a",
  path: "/repo/a",
  backend: "local",
};
const workspaceB: LspSessionWorkspace = {
  id: "ws-b",
  path: "/repo/b",
  backend: "local",
};

function statusBody(
  workspaceId: string,
  overrides: Partial<LspStatusResponse> = {},
): LspStatusResponse {
  return {
    workspaceId,
    serverEpoch: 7,
    state: "running",
    wsUrl: `ws://127.0.0.1:7601/?workspaceId=${workspaceId}&epoch=7`,
    error: null,
    ...overrides,
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

let startResponder: (workspaceId: string) => Response | Promise<Response>;
let pollResponder: (workspaceId: string, pollNumber: number) => Response;
let connectImpl: (options: ConnectOptions) => Promise<LspSessionHandle>;
let pollCount = 0;
const fetchMock = vi.fn(
  async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (init?.method === "POST") {
      const body: unknown = JSON.parse(String(init.body));
      const { action, workspaceId } = body as {
        action: string;
        workspaceId: string;
      };
      if (action === "start") return startResponder(workspaceId);
      return jsonResponse(200, statusBody(workspaceId, { state: "stopped" }));
    }
    pollCount += 1;
    const workspaceId = new URL(url, "http://x").searchParams.get(
      "workspaceId",
    );
    return pollResponder(workspaceId ?? "", pollCount);
  },
);
const connectOptionsLog: ConnectOptions[] = [];
const handles: FakeHandle[] = [];
const connectMock = vi.fn((options: ConnectOptions) => {
  connectOptionsLog.push(options);
  return connectImpl(options);
});
const restoreBuiltin = vi.fn();

function succeedingConnect(options: ConnectOptions): Promise<LspSessionHandle> {
  const handle: FakeHandle = {
    workspaceId: options.workspaceId,
    dispose: vi.fn(),
  };
  handles.push(handle);
  return Promise.resolve(handle);
}

function postedActions(): { action: string; workspaceId: string }[] {
  return fetchMock.mock.calls
    .filter(([, init]) => init?.method === "POST")
    .map(([, init]) => JSON.parse(String(init?.body)));
}

async function flushMicrotasks(): Promise<void> {
  for (let turn = 0; turn < 50; turn++) await Promise.resolve();
}

function inputs(overrides: Partial<LspSessionInputs> = {}): LspSessionInputs {
  return {
    isLspEnabled: true,
    workspace: workspaceA,
    isMonacoRegistered: true,
    retryNonce: 0,
    ...overrides,
  };
}

function lastClose(code: number): void {
  connectOptionsLog.at(-1)?.onUnexpectedClose(code, "closed");
}

function deferStartFor(deferredWorkspaceId: string): {
  resolveStart: (response: Response) => void;
} {
  let resolveDeferred: (response: Response) => void = () => {};
  const fallbackResponder = startResponder;
  let isDeferredUsed = false;
  startResponder = (workspaceId) => {
    if (workspaceId !== deferredWorkspaceId || isDeferredUsed) {
      return fallbackResponder(workspaceId);
    }
    isDeferredUsed = true;
    return new Promise<Response>((resolve) => {
      resolveDeferred = resolve;
    });
  };
  return { resolveStart: (response) => resolveDeferred(response) };
}

function startingResponse(workspaceId: string): Response {
  return jsonResponse(200, statusBody(workspaceId, { state: "starting" }));
}

let controller: LspSessionController;

beforeEach(() => {
  vi.useFakeTimers();
  useLspStore.setState(initialLspState, true);
  fetchMock.mockClear();
  connectMock.mockClear();
  restoreBuiltin.mockClear();
  connectOptionsLog.length = 0;
  handles.length = 0;
  pollCount = 0;
  startResponder = (workspaceId) =>
    jsonResponse(200, statusBody(workspaceId, { state: "starting" }));
  pollResponder = (workspaceId) => jsonResponse(200, statusBody(workspaceId));
  connectImpl = succeedingConnect;
  controller = createLspSessionController({
    fetchImpl: fetchMock,
    connect: connectMock,
    restoreBuiltin,
  });
});

afterEach(() => {
  controller.dispose();
  vi.useRealTimers();
});

describe("createLspSessionController lifecycle", () => {
  it("makes zero fetch calls when disabled", async () => {
    controller.update(inputs({ isLspEnabled: false }));
    await vi.advanceTimersByTimeAsync(60_000);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(useLspStore.getState().status).toBe("disabled");
  });

  it("reports unavailable for remote workspaces without fetching", async () => {
    controller.update(
      inputs({ workspace: { ...workspaceA, backend: "remote" } }),
    );
    await flushMicrotasks();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(useLspStore.getState().status).toBe("unavailable");
    expect(restoreBuiltin).toHaveBeenCalled();
  });

  it("waits for the editor before fetching", async () => {
    controller.update(inputs({ isMonacoRegistered: false }));
    await flushMicrotasks();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(useLspStore.getState().status).toBe("waiting-for-editor");
  });

  it("starts, polls until running and connects with the wsUrl", async () => {
    pollResponder = (workspaceId, pollNumber) =>
      jsonResponse(
        200,
        pollNumber < 3
          ? statusBody(workspaceId, {
              state: "starting",
              wsUrl: null,
              serverEpoch: null,
            })
          : statusBody(workspaceId),
      );

    controller.update(inputs());
    await flushMicrotasks();
    expect(postedActions()).toEqual([{ action: "start", workspaceId: "ws-a" }]);
    expect(pollCount).toBe(1);
    expect(connectMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(2000);

    expect(pollCount).toBe(3);
    expect(connectMock).toHaveBeenCalledTimes(1);
    expect(connectOptionsLog[0]).toMatchObject({
      wsUrl: statusBody("ws-a").wsUrl,
      workspaceId: "ws-a",
      workspaceRoot: "/repo/a",
    });
    expect(useLspStore.getState()).toMatchObject({
      status: "connected",
      sessionWorkspaceId: "ws-a",
      serverEpoch: 7,
    });
    const startInit = fetchMock.mock.calls[0]?.[1];
    expect(startInit?.headers).toEqual({ "Content-Type": "application/json" });

    await vi.advanceTimersByTimeAsync(120_000);
    expect(pollCount).toBe(3);
  });

  it("marks busy on 409, restores built-ins and makes no further calls", async () => {
    startResponder = () =>
      jsonResponse(409, { error: "busy", code: "LSP_BUSY" });

    controller.update(inputs());
    await vi.advanceTimersByTimeAsync(120_000);

    expect(useLspStore.getState().status).toBe("busy");
    expect(restoreBuiltin).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(connectMock).not.toHaveBeenCalled();
  });

  it("reports the body error and restores built-ins when start fails", async () => {
    startResponder = () => jsonResponse(500, { error: "spawn failed" });

    controller.update(inputs());
    await flushMicrotasks();

    expect(useLspStore.getState()).toMatchObject({
      status: "error",
      errorMessage: "spawn failed",
    });
    expect(restoreBuiltin).toHaveBeenCalledTimes(1);
    expect(connectMock).not.toHaveBeenCalled();
  });

  it("reports the server error message when a poll returns state error", async () => {
    pollResponder = (workspaceId) =>
      jsonResponse(
        200,
        statusBody(workspaceId, {
          state: "error",
          wsUrl: null,
          error: "vtsls crashed",
        }),
      );

    controller.update(inputs());
    await flushMicrotasks();

    expect(useLspStore.getState()).toMatchObject({
      status: "error",
      errorMessage: "vtsls crashed",
    });
    expect(restoreBuiltin).toHaveBeenCalledTimes(1);
  });

  it("gives up after 30 polls without a running server", async () => {
    pollResponder = (workspaceId) =>
      jsonResponse(
        200,
        statusBody(workspaceId, {
          state: "starting",
          wsUrl: null,
          serverEpoch: null,
        }),
      );

    controller.update(inputs());
    await vi.advanceTimersByTimeAsync(60_000);

    expect(pollCount).toBe(30);
    expect(useLspStore.getState()).toMatchObject({
      status: "error",
      errorMessage: "LSP server did not start",
    });
    expect(connectMock).not.toHaveBeenCalled();
    expect(restoreBuiltin).toHaveBeenCalledTimes(1);
  });

  it("switches workspaces by stopping the old one without restoring", async () => {
    controller.update(inputs());
    await flushMicrotasks();
    const handleA = handles[0];

    controller.update(inputs({ workspace: workspaceB }));
    await flushMicrotasks();

    expect(handleA?.dispose).toHaveBeenCalledTimes(1);
    expect(postedActions()).toEqual([
      { action: "start", workspaceId: "ws-a" },
      { action: "stop", workspaceId: "ws-a" },
      { action: "start", workspaceId: "ws-b" },
    ]);
    expect(connectOptionsLog.at(-1)?.workspaceId).toBe("ws-b");
    expect(useLspStore.getState().status).toBe("connected");
    expect(restoreBuiltin).not.toHaveBeenCalled();
  });

  it("disabling disposes, stops the server and restores built-ins", async () => {
    controller.update(inputs());
    await flushMicrotasks();

    controller.update(inputs({ isLspEnabled: false }));
    await flushMicrotasks();

    expect(handles[0]?.dispose).toHaveBeenCalledTimes(1);
    expect(postedActions().at(-1)).toEqual({
      action: "stop",
      workspaceId: "ws-a",
    });
    expect(restoreBuiltin).toHaveBeenCalledTimes(1);
    expect(useLspStore.getState()).toMatchObject({
      status: "disabled",
      sessionWorkspaceId: null,
    });
  });

  it("disposes the handle of a superseded attempt", async () => {
    let resolveFirstConnect: (handle: LspSessionHandle) => void = () => {};
    connectImpl = (options) => {
      if (options.workspaceId === "ws-a") {
        return new Promise((resolve) => {
          resolveFirstConnect = resolve;
        });
      }
      return succeedingConnect(options);
    };
    controller.update(inputs());
    await flushMicrotasks();
    controller.update(inputs({ workspace: workspaceB }));
    await flushMicrotasks();

    const staleHandle: FakeHandle = { workspaceId: "ws-a", dispose: vi.fn() };
    resolveFirstConnect(staleHandle);
    await flushMicrotasks();

    expect(staleHandle.dispose).toHaveBeenCalledTimes(1);
    expect(useLspStore.getState()).toMatchObject({
      status: "connected",
      sessionWorkspaceId: "ws-b",
    });
  });

  it("does not retry after a 4001 busy close", async () => {
    controller.update(inputs());
    await flushMicrotasks();

    lastClose(4001);
    await vi.advanceTimersByTimeAsync(120_000);

    expect(useLspStore.getState().status).toBe("busy");
    expect(connectMock).toHaveBeenCalledTimes(1);
    expect(handles[0]?.dispose).toHaveBeenCalledTimes(1);
    expect(restoreBuiltin).toHaveBeenCalledTimes(1);
  });
});

describe("retry limits", () => {
  async function expectNextConnectAfter(
    delayMs: number,
    expectedCalls: number,
  ): Promise<void> {
    await vi.advanceTimersByTimeAsync(delayMs - 1);
    expect(connectMock).toHaveBeenCalledTimes(expectedCalls - 1);
    await vi.advanceTimersByTimeAsync(1);
    expect(connectMock).toHaveBeenCalledTimes(expectedCalls);
  }

  it("retries a rejecting connect 5 times with backoff, then errors", async () => {
    connectImpl = () => Promise.reject(new Error("socket refused"));

    controller.update(inputs());
    await flushMicrotasks();
    expect(connectMock).toHaveBeenCalledTimes(1);

    await expectNextConnectAfter(1000, 2);
    await expectNextConnectAfter(2000, 3);
    await expectNextConnectAfter(4000, 4);
    await expectNextConnectAfter(8000, 5);
    expect(restoreBuiltin).not.toHaveBeenCalled();
    await expectNextConnectAfter(16000, 6);

    expect(useLspStore.getState()).toMatchObject({
      status: "error",
      errorMessage: "LSP connection failed repeatedly",
    });
    expect(restoreBuiltin).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(300_000);
    expect(connectMock).toHaveBeenCalledTimes(6);
  });

  it("applies the same backoff to repeated unexpected closes", async () => {
    controller.update(inputs());
    await flushMicrotasks();

    const delays = [1000, 2000, 4000, 8000, 16000];
    for (const [index, delay] of delays.entries()) {
      lastClose(4004);
      expect(handles[index]?.dispose).toHaveBeenCalledTimes(1);
      await expectNextConnectAfter(delay, index + 2);
      expect(useLspStore.getState().status).toBe("connected");
    }
    lastClose(4004);
    await flushMicrotasks();

    expect(useLspStore.getState()).toMatchObject({
      status: "error",
      errorMessage: "LSP connection failed repeatedly",
    });
    expect(restoreBuiltin).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(300_000);
    expect(connectMock).toHaveBeenCalledTimes(6);
  });

  it("resets the failure count after 30 s of stable connection", async () => {
    controller.update(inputs());
    await flushMicrotasks();
    lastClose(4004);
    await expectNextConnectAfter(1000, 2);
    lastClose(4004);
    await expectNextConnectAfter(2000, 3);

    await vi.advanceTimersByTimeAsync(30_000);
    lastClose(4004);

    await expectNextConnectAfter(1000, 4);
  });

  it("resets the counter and reconnects when retryNonce changes", async () => {
    connectImpl = () => Promise.reject(new Error("socket refused"));
    controller.update(inputs());
    await vi.advanceTimersByTimeAsync(60_000);
    expect(connectMock).toHaveBeenCalledTimes(6);
    expect(useLspStore.getState().status).toBe("error");

    controller.update(inputs({ retryNonce: 1 }));
    await flushMicrotasks();

    expect(connectMock).toHaveBeenCalledTimes(7);
    await expectNextConnectAfter(1000, 8);
  });

  it("never retries after a busy start", async () => {
    startResponder = () =>
      jsonResponse(409, { error: "busy", code: "LSP_BUSY" });
    controller.update(inputs());
    controller.update(inputs());
    await vi.advanceTimersByTimeAsync(300_000);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(connectMock).not.toHaveBeenCalled();
  });
});

describe("superseded in-flight start", () => {
  it("stops the server when disabled while start is outstanding and it succeeds", async () => {
    const { resolveStart } = deferStartFor("ws-a");
    controller.update(inputs());
    await flushMicrotasks();
    controller.update(inputs({ isLspEnabled: false }));
    await flushMicrotasks();

    resolveStart(startingResponse("ws-a"));
    await vi.advanceTimersByTimeAsync(60_000);

    expect(postedActions()).toEqual([
      { action: "start", workspaceId: "ws-a" },
      { action: "stop", workspaceId: "ws-a" },
    ]);
    expect(useLspStore.getState().status).toBe("disabled");
    expect(connectMock).not.toHaveBeenCalled();
    expect(pollCount).toBe(0);
  });

  it("stops the old workspace server before starting the new one on switch", async () => {
    const { resolveStart } = deferStartFor("ws-a");
    controller.update(inputs());
    await flushMicrotasks();
    controller.update(inputs({ workspace: workspaceB }));
    await flushMicrotasks();
    expect(postedActions()).toEqual([{ action: "start", workspaceId: "ws-a" }]);

    resolveStart(startingResponse("ws-a"));
    await flushMicrotasks();

    expect(postedActions()).toEqual([
      { action: "start", workspaceId: "ws-a" },
      { action: "stop", workspaceId: "ws-a" },
      { action: "start", workspaceId: "ws-b" },
    ]);
    expect(connectOptionsLog.map((options) => options.workspaceId)).toEqual([
      "ws-b",
    ]);
    expect(useLspStore.getState()).toMatchObject({
      status: "connected",
      sessionWorkspaceId: "ws-b",
    });
  });

  it("does not stop when a newer attempt targets the same workspace", async () => {
    const { resolveStart } = deferStartFor("ws-a");
    controller.update(inputs());
    await flushMicrotasks();
    controller.update(inputs({ isLspEnabled: false }));
    controller.update(inputs());
    await flushMicrotasks();

    resolveStart(startingResponse("ws-a"));
    await flushMicrotasks();

    expect(postedActions().map((posted) => posted.action)).not.toContain(
      "stop",
    );
    expect(connectMock).toHaveBeenCalledTimes(1);
    expect(useLspStore.getState()).toMatchObject({
      status: "connected",
      sessionWorkspaceId: "ws-a",
    });

    controller.update(inputs({ isLspEnabled: false }));
    await flushMicrotasks();
    expect(postedActions().at(-1)).toEqual({
      action: "stop",
      workspaceId: "ws-a",
    });
  });

  it.each([
    [409, { error: "busy", code: "LSP_BUSY" }],
    [500, { error: "spawn failed" }],
  ])(
    "does not stop when the superseded start resolves %i",
    async (status, body) => {
      const { resolveStart } = deferStartFor("ws-a");
      controller.update(inputs());
      await flushMicrotasks();
      controller.update(inputs({ isLspEnabled: false }));
      await flushMicrotasks();

      resolveStart(jsonResponse(status, body));
      await vi.advanceTimersByTimeAsync(60_000);

      expect(postedActions()).toEqual([
        { action: "start", workspaceId: "ws-a" },
      ]);
      expect(useLspStore.getState().status).toBe("disabled");
      expect(connectMock).not.toHaveBeenCalled();
    },
  );
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LspSessionHandle } from "@/lib/lsp/client/lsp-session";
import {
  createLspSessionController,
  type LspSessionController,
  type LspSessionInputs,
  type LspSessionWorkspace,
} from "@/lib/lsp/client/session-controller";
import { LSP_EDITORLESS_RELEASE_MS } from "@/lib/lsp/types";
import { useLspStore } from "@/stores/lsp-store";

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

const events: string[] = [];
let settleDisposal: { resolve(): void; reject(error: Error): void };

function runningStatus(workspaceId: string): Response {
  return new Response(
    JSON.stringify({
      workspaceId,
      serverEpoch: 7,
      pid: 4242,
      state: "running",
      wsUrl: `ws://127.0.0.1:7601/?workspaceId=${workspaceId}&epoch=7`,
      error: null,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

const fetchMock = vi.fn(
  async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (init?.method === "POST") {
      const body: unknown = JSON.parse(String(init.body));
      const { action, workspaceId } = body as {
        action: string;
        workspaceId: string;
      };
      events.push(`${action} ${workspaceId}`);
      return runningStatus(workspaceId);
    }
    const workspaceId =
      new URL(String(input), "http://x").searchParams.get("workspaceId") ?? "";
    return runningStatus(workspaceId);
  },
);

const connectMock = vi.fn(
  async ({
    workspaceId,
  }: {
    readonly workspaceId: string;
  }): Promise<LspSessionHandle> => ({
    workspaceId,
    dispose: () => {
      events.push(`dispose ${workspaceId}`);
      return new Promise<void>((resolve, reject) => {
        settleDisposal = { resolve, reject };
      });
    },
  }),
);

function inputs(overrides: Partial<LspSessionInputs> = {}): LspSessionInputs {
  return {
    isLspEnabled: true,
    workspace: workspaceA,
    isMonacoRegistered: true,
    hasAttachedEditor: true,
    retryNonce: 0,
    ...overrides,
  };
}

async function flushMicrotasks(): Promise<void> {
  for (let turn = 0; turn < 50; turn++) await Promise.resolve();
}

let controller: LspSessionController;

beforeEach(async () => {
  vi.useFakeTimers();
  useLspStore.setState(initialLspState, true);
  events.length = 0;
  fetchMock.mockClear();
  connectMock.mockClear();
  controller = createLspSessionController({
    fetchImpl: fetchMock,
    connect: connectMock,
    restoreBuiltin: vi.fn(),
  });
  controller.update(inputs());
  await flushMicrotasks();
  expect(useLspStore.getState().status).toBe("connected");
});

afterEach(() => {
  controller.dispose();
  vi.useRealTimers();
});

describe("deliberate teardown stops the server only after the client shut down", () => {
  it("waits for the session disposal before posting stop when LSP is disabled", async () => {
    controller.update(inputs({ isLspEnabled: false }));
    await flushMicrotasks();
    expect(events).toEqual(["start ws-a", "dispose ws-a"]);

    settleDisposal.resolve();
    await flushMicrotasks();

    expect(events).toEqual(["start ws-a", "dispose ws-a", "stop ws-a"]);
  });

  it("stops the old workspace after its disposal and only then starts the new one", async () => {
    controller.update(inputs({ workspace: workspaceB }));
    await flushMicrotasks();
    expect(events).toEqual(["start ws-a", "dispose ws-a"]);

    settleDisposal.resolve();
    await flushMicrotasks();

    expect(events).toEqual([
      "start ws-a",
      "dispose ws-a",
      "stop ws-a",
      "start ws-b",
    ]);
  });

  it("waits for the session disposal before stopping on editor-less release", async () => {
    controller.update(inputs({ hasAttachedEditor: false }));
    await vi.advanceTimersByTimeAsync(LSP_EDITORLESS_RELEASE_MS);
    expect(events).toEqual(["start ws-a", "dispose ws-a"]);

    settleDisposal.resolve();
    await flushMicrotasks();

    expect(events).toEqual(["start ws-a", "dispose ws-a", "stop ws-a"]);
  });

  it("still stops the server when the session disposal fails", async () => {
    controller.update(inputs({ isLspEnabled: false }));
    await flushMicrotasks();

    settleDisposal.reject(new Error("client stop timed out"));
    await flushMicrotasks();

    expect(events).toEqual(["start ws-a", "dispose ws-a", "stop ws-a"]);
  });
});

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockAuth = vi.fn();
vi.mock("@/lib/auth/config", () => ({ auth: mockAuth }));

const mockWhere = vi.fn();
const mockFrom = vi.fn(() => ({ where: mockWhere }));
const mockSelect = vi.fn(() => ({ from: mockFrom }));
vi.mock("@/lib/db", () => ({ db: { select: mockSelect } }));
vi.mock("@/drizzle/schema", () => ({
  workspaces: { id: "id", userId: "userId" },
}));
vi.mock("drizzle-orm", () => ({
  and: vi.fn((...values: unknown[]) => values),
  eq: vi.fn((...values: unknown[]) => values),
  inArray: vi.fn((...values: unknown[]) => values),
}));

const mockToWorkspace = vi.fn((row: { id: string }) => ({
  ...row,
  backend: "remote",
  path: "/workspace",
}));
const mockGetBackend = vi.fn((workspace: { id: string }) => ({
  getOpenCodeUrl: vi.fn(async () => `http://${workspace.id}`),
}));
vi.mock("@/lib/workspaces/backend", () => ({
  toWorkspace: (row: unknown) => mockToWorkspace(row as { id: string }),
  getBackend: (workspace: unknown) =>
    mockGetBackend(workspace as { id: string }),
}));

function finiteEventStream(event: string): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`data: ${event}\n\n`));
        controller.close();
      },
    }),
    { status: 200 },
  );
}

function openEventStream(event: string): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`data: ${event}\n\n`));
      },
    }),
    { status: 200 },
  );
}

async function flushMicrotasks(ticks = 20): Promise<void> {
  for (let index = 0; index < ticks; index += 1) await Promise.resolve();
}

describe("GET /api/opencode/events", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockAuth.mockResolvedValue({ user: { id: "user-1" } });
    mockWhere.mockResolvedValue([{ id: "ws-a" }, { id: "ws-b" }]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reconnects a closed upstream while leaving its healthy sibling connected", async () => {
    let upstreamFetches = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        upstreamFetches += 1;
        if (upstreamFetches === 1) {
          return finiteEventStream('{"type":"a-1"}');
        }
        if (upstreamFetches === 2) {
          return openEventStream('{"type":"b-1"}');
        }
        return openEventStream('{"type":"a-2"}');
      }),
    );

    const abortController = new AbortController();
    const { GET } = await import("@/app/api/opencode/events/route");
    const response = await GET(
      new NextRequest(
        "http://localhost:3000/api/opencode/events?workspaceIds=ws-a,ws-b",
        { signal: abortController.signal },
      ),
    );
    const reader = response.body?.getReader();
    await reader?.read();
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(1_000);
    await flushMicrotasks();

    expect(upstreamFetches).toBe(3);

    abortController.abort();
    await reader?.cancel();
  });

  it("retries initial workspace target resolution instead of omitting it", async () => {
    mockWhere.mockResolvedValue([{ id: "ws-a" }]);
    const getOpenCodeUrl = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("workspace suspended"))
      .mockResolvedValue("http://ws-a");
    mockGetBackend.mockReturnValue({ getOpenCodeUrl });
    const upstreamFetch = vi.fn(async () => openEventStream('{"type":"a"}'));
    vi.stubGlobal("fetch", upstreamFetch);

    const abortController = new AbortController();
    const { GET } = await import("@/app/api/opencode/events/route");
    const response = await GET(
      new NextRequest(
        "http://localhost:3000/api/opencode/events?workspaceIds=ws-a",
        { signal: abortController.signal },
      ),
    );
    const reader = response.body?.getReader();
    await vi.advanceTimersByTimeAsync(1_000);
    await flushMicrotasks();

    expect(getOpenCodeUrl).toHaveBeenCalledTimes(2);
    expect(upstreamFetch).toHaveBeenCalledTimes(1);

    abortController.abort();
    await reader?.cancel();
  });
});

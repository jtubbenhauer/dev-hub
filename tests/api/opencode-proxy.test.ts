import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { Workspace } from "@/types";

const mockAuth = vi.fn();
vi.mock("@/lib/auth/config", () => ({ auth: mockAuth }));

const mockWhere = vi.fn();
const mockFrom = vi.fn();
const mockSelect = vi.fn();
const mockDbChain = {
  from: mockFrom,
  where: mockWhere,
};

mockFrom.mockReturnValue(mockDbChain);
mockSelect.mockReturnValue(mockDbChain);
mockWhere.mockResolvedValue([]);

vi.mock("@/lib/db", () => ({
  db: { select: mockSelect },
}));

vi.mock("@/drizzle/schema", () => ({
  workspaces: { id: "id", userId: "userId" },
  settings: { userId: "userId", key: "key" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a, b) => ({ eq: [a, b] })),
  and: vi.fn((...args) => ({ and: args })),
}));

const mockToWorkspace = vi.fn();
const mockGetBackend = vi.fn();
vi.mock("@/lib/workspaces/backend", () => ({
  toWorkspace: (...args: unknown[]) => mockToWorkspace(...args),
  getBackend: (...args: unknown[]) => mockGetBackend(...args),
}));

function makeRemoteWorkspaceRow() {
  return {
    id: "ws-1",
    userId: "user-1",
    name: "remote-1",
    path: "/workspace",
    backend: "remote",
    providerMeta: {
      providerId: "provider-1",
      providerWorkspaceId: "remote-1",
    } as Record<string, unknown>,
  };
}

function makeRemoteWorkspace(): Workspace {
  return {
    id: "ws-1",
    userId: "user-1",
    name: "remote-1",
    path: "/workspace",
    type: "repo",
    parentRepoPath: null,
    packageManager: null,
    quickCommands: null,
    backend: "remote",
    provider: "rig",
    opencodeUrl: "http://127.0.0.1:4096",
    agentUrl: "http://127.0.0.1:7500",
    providerMeta: {
      providerId: "provider-1",
      providerWorkspaceId: "remote-1",
    },
    shellCommand: null,
    worktreeSymlinks: null,
    linkedTaskId: null,
    linkedTaskMeta: null,
    color: null,
    createdAt: new Date(),
    lastAccessedAt: new Date(),
  };
}

describe("OpenCode proxy route retry", () => {
  let GET: (
    req: NextRequest,
    ctx: { params: Promise<{ path: string[] }> },
  ) => Promise<Response>;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useRealTimers();
    mockAuth.mockResolvedValue({ user: { id: "user-1" } });
    mockWhere.mockResolvedValue([]);
    mockToWorkspace.mockReturnValue(makeRemoteWorkspace());
    mockGetBackend.mockReturnValue({
      getOpenCodeUrl: vi.fn(async () => "http://127.0.0.1:4096"),
    });

    const mod = await import("@/app/api/opencode/[...path]/route");
    GET = mod.GET;
  });

  it("retries upstream fetch for remote auto-suspend workspace and returns retry response", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockRejectedValueOnce(new Error("ECONNREFUSED"))
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        ),
    );

    mockWhere
      .mockResolvedValueOnce([makeRemoteWorkspaceRow()])
      .mockResolvedValueOnce([
        {
          value: [
            {
              id: "provider-1",
              behaviour: { supportsAutoSuspend: true },
            },
          ],
        },
      ]);

    const mod = await import("@/app/api/opencode/[...path]/route");

    const promise = mod.POST(
      new NextRequest(
        "http://localhost:3000/api/opencode/session?workspaceId=ws-1",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
        },
      ),
      { params: Promise.resolve({ path: ["session"] }) },
    );

    await vi.advanceTimersByTimeAsync(2_000);
    const response = await promise;

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
  });

  it("does not retry GET requests for remote auto-suspend workspace", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("ECONNREFUSED")),
    );

    mockWhere
      .mockResolvedValueOnce([makeRemoteWorkspaceRow()])
      .mockResolvedValueOnce([
        {
          value: [
            {
              id: "provider-1",
              behaviour: { supportsAutoSuspend: true },
            },
          ],
        },
      ]);

    const response = await GET(
      new NextRequest(
        "http://localhost:3000/api/opencode/session?workspaceId=ws-1",
      ),
      { params: Promise.resolve({ path: ["session"] }) },
    );

    expect(response.status).toBe(502);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it("does not retry SSE requests when upstream fetch fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("socket error")),
    );

    mockWhere.mockResolvedValueOnce([makeRemoteWorkspaceRow()]);

    const response = await GET(
      new NextRequest(
        "http://localhost:3000/api/opencode/event?workspaceId=ws-1",
        {
          headers: { accept: "text/event-stream" },
        },
      ),
      { params: Promise.resolve({ path: ["event"] }) },
    );

    expect(response.status).toBe(502);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it("returns 504 when upstream never sends response headers within the timeout", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, opts?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            opts?.signal?.addEventListener("abort", () => {
              reject(
                (opts.signal as AbortSignal).reason ??
                  new DOMException("Aborted", "AbortError"),
              );
            });
          }),
      ),
    );

    mockWhere.mockResolvedValueOnce([makeRemoteWorkspaceRow()]);

    const promise = GET(
      new NextRequest(
        "http://localhost:3000/api/opencode/session/s1/message?workspaceId=ws-1",
      ),
      { params: Promise.resolve({ path: ["session", "s1", "message"] }) },
    );

    await vi.advanceTimersByTimeAsync(15_000);
    const response = await promise;

    expect(response.status).toBe(504);
  });

  it("does not abort the body stream once headers arrive (slow mobile client)", async () => {
    vi.useFakeTimers();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("chunk"));
        controller.close();
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(body, {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ),
    );

    mockWhere.mockResolvedValueOnce([makeRemoteWorkspaceRow()]);

    const response = await GET(
      new NextRequest(
        "http://localhost:3000/api/opencode/session/s1/message?workspaceId=ws-1",
      ),
      { params: Promise.resolve({ path: ["session", "s1", "message"] }) },
    );

    expect(response.status).toBe(200);

    // Past the 15s header timeout: a cleared timer means the stream survives.
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await response.text()).toBe("chunk");
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mockAuth = vi.fn();
vi.mock("@/lib/auth/config", () => ({ auth: mockAuth }));

const mockResolve = vi.fn();
class FakeTargetError extends Error {
  constructor(
    public status: number,
    message: string,
    public detail?: string,
  ) {
    super(message);
  }
}
vi.mock("@/lib/opencode/proxy-target", () => ({
  resolveOpenCodeTarget: (...args: unknown[]) => mockResolve(...args),
  OpenCodeTargetError: FakeTargetError,
}));

const mockRead = vi.fn();
const mockWrite = vi.fn();
vi.mock("@/lib/opencode/message-cache", () => ({
  readMessageCache: (...args: unknown[]) => mockRead(...args),
  writeMessageCache: (...args: unknown[]) => mockWrite(...args),
  MESSAGE_CACHE_FRESH_MS: 60_000,
}));

const mockFetch = vi.fn();
vi.mock("@/lib/opencode/fetch-timeout", () => ({
  fetchWithHeaderTimeout: (...args: unknown[]) => mockFetch(...args),
}));

function msg(id: string, output?: string) {
  const parts =
    output !== undefined
      ? [
          {
            id: `p-${id}`,
            sessionID: "s",
            messageID: id,
            type: "tool",
            callID: `c-${id}`,
            tool: "read",
            state: {
              status: "completed",
              input: {},
              output,
              title: "t",
              metadata: {},
              time: { start: 1, end: 2 },
            },
          },
        ]
      : [];
  return {
    info: { id, sessionID: "s", role: "assistant", time: { created: 1 } },
    parts,
  };
}

async function get(params: Record<string, string>) {
  const url = new URL("http://localhost:3000/api/sessions/messages");
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  const { GET } = await import("@/app/api/sessions/messages/route");
  return GET(new NextRequest(url.toString()));
}

describe("GET /api/sessions/messages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ user: { id: "user-1" } });
    mockResolve.mockResolvedValue({
      serverUrl: "http://127.0.0.1:4096",
      directory: undefined,
      workspace: null,
    });
  });

  it("requires sessionId and workspaceId", async () => {
    const res = await get({ workspaceId: "ws-1" });
    expect(res.status).toBe(400);
  });

  it("serves the last window from a fresh cache without hitting OpenCode", async () => {
    mockRead.mockResolvedValue({
      messages: [msg("a"), msg("b"), msg("c")],
      cachedAt: Date.now(),
    });

    const res = await get({ sessionId: "s1", workspaceId: "ws-1", limit: "2" });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.source).toBe("cache");
    expect(
      body.messages.map((m: { info: { id: string } }) => m.info.id),
    ).toEqual(["b", "c"]);
    expect(body.hasMore).toBe(true);
    expect(body.total).toBe(3);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it("fetches from OpenCode on cache miss, truncates output, and writes cache", async () => {
    mockRead.mockResolvedValue(null);
    const bigOutput = "x".repeat(10_000);
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify([msg("a"), msg("b", bigOutput)]), {
        status: 200,
      }),
    );

    const res = await get({ sessionId: "s1", workspaceId: "ws-1" });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.source).toBe("remote");
    expect(body.total).toBe(2);
    expect(body.messages[1].parts[0].state.output).toHaveLength(2000);
    expect(mockWrite).toHaveBeenCalledOnce();
  });

  it("windows before an anchor for load-older", async () => {
    mockRead.mockResolvedValue({
      messages: [msg("a"), msg("b"), msg("c"), msg("d"), msg("e")],
      cachedAt: Date.now(),
    });

    const res = await get({
      sessionId: "s1",
      workspaceId: "ws-1",
      before: "d",
      limit: "2",
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(
      body.messages.map((m: { info: { id: string } }) => m.info.id),
    ).toEqual(["b", "c"]);
    expect(body.hasMore).toBe(true);
  });

  it("returns 409 when the load-older anchor no longer exists", async () => {
    mockRead.mockResolvedValue({
      messages: [msg("a"), msg("b")],
      cachedAt: Date.now(),
    });

    const res = await get({
      sessionId: "s1",
      workspaceId: "ws-1",
      before: "gone",
    });
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.code).toBe("ANCHOR_NOT_FOUND");
  });

  it("falls back to stale cache when OpenCode is unreachable", async () => {
    mockRead.mockResolvedValue({
      messages: [msg("a"), msg("b")],
      cachedAt: Date.now() - 999_999,
    });
    mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));

    const res = await get({ sessionId: "s1", workspaceId: "ws-1" });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.source).toBe("stale-cache");
    expect(body.messages).toHaveLength(2);
  });

  it("returns 504 on upstream timeout with no cache to fall back on", async () => {
    mockRead.mockResolvedValue(null);
    mockFetch.mockRejectedValue(
      new DOMException("Header timeout", "TimeoutError"),
    );

    const res = await get({ sessionId: "s1", workspaceId: "ws-1" });
    expect(res.status).toBe(504);
  });
});

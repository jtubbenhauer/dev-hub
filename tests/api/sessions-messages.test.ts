import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mockAuth = vi.fn();
vi.mock("@/lib/auth/config", () => ({ auth: mockAuth }));

const mockResolve = vi.fn();
const mockAuthorize = vi.fn();
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
  authorizeOpenCodeSession: (...args: unknown[]) => mockAuthorize(...args),
  OpenCodeTargetError: FakeTargetError,
}));

const mockRead = vi.fn();
const mockWrite = vi.fn();
const mockPurgeCache = vi.fn();
vi.mock("@/lib/opencode/message-cache", () => ({
  readMessageCache: (...args: unknown[]) => mockRead(...args),
  writeMessageCache: (...args: unknown[]) => mockWrite(...args),
  purgeMessageCache: (...args: unknown[]) => mockPurgeCache(...args),
  MESSAGE_CACHE_FRESH_MS: 60_000,
}));

const mockReadRecovered = vi.fn();
const mockWriteRecovered = vi.fn();
const mockPurgeRecovered = vi.fn();
vi.mock("@/lib/opencode/recovered-message-cache", () => ({
  readRecoveredMessages: (...args: unknown[]) => mockReadRecovered(...args),
  writeRecoveredMessages: (...args: unknown[]) => mockWriteRecovered(...args),
  purgeRecoveredMessages: (...args: unknown[]) => mockPurgeRecovered(...args),
}));

const mockPurgeHistory = vi.fn();
vi.mock("@/lib/opencode/message-history-purge", () => ({
  purgeMessageHistory: (...args: unknown[]) => mockPurgeHistory(...args),
}));

const mockFetch = vi.fn();
vi.mock("@/lib/opencode/fetch-timeout", () => ({
  fetchWithHeaderTimeout: (...args: unknown[]) => mockFetch(...args),
}));

function msg(id: string, output?: string, created = 1) {
  const parts =
    output !== undefined
      ? [
          {
            id: `p-${id}`,
            sessionID: "s1",
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
      : [
          {
            id: `p-${id}`,
            sessionID: "s1",
            messageID: id,
            type: "text",
            text: id,
          },
        ];
  return {
    info: {
      id,
      sessionID: "s1",
      role: "assistant",
      parentID: "user-message",
      modelID: "model",
      providerID: "provider",
      mode: "build",
      path: { cwd: "/workspace", root: "/workspace" },
      cost: 0,
      tokens: {
        input: 0,
        output: 0,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      },
      time: { created },
    },
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

async function del(params: Record<string, string>) {
  const { DELETE } = await import("@/app/api/sessions/messages/route");
  const url = new URL("http://localhost:3000/api/sessions/messages");
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return DELETE(new NextRequest(url.toString(), { method: "DELETE" }));
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
    mockAuthorize.mockResolvedValue(undefined);
    mockWrite.mockResolvedValue(undefined);
    mockReadRecovered.mockResolvedValue([]);
  });

  it("requires sessionId and workspaceId", async () => {
    const res = await get({ workspaceId: "ws-1" });
    expect(res.status).toBe(400);
  });

  it("serves the last window from a fresh cache without hitting OpenCode", async () => {
    mockRead.mockResolvedValue({
      messages: [msg("a"), msg("b"), msg("c")],
      authoritativeMessageIds: ["a", "b", "c"],
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

  it("refetches instead of serving an empty cache written while OpenCode was still persisting", async () => {
    mockRead.mockResolvedValue({
      messages: [],
      authoritativeMessageIds: [],
      cachedAt: Date.now(),
    });
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [msg("a"), msg("b")],
    });

    const res = await get({ sessionId: "s1", workspaceId: "ws-1" });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalled();
    expect(body.source).toBe("remote");
    expect(
      body.messages.map((m: { info: { id: string } }) => m.info.id),
    ).toEqual(["a", "b"]);
  });

  it("never caches an empty upstream result, so a racing fetch cannot mask real messages", async () => {
    mockRead.mockResolvedValue(null);
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [],
    });

    const res = await get({ sessionId: "s1", workspaceId: "ws-1" });

    expect(res.status).toBe(200);
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it("does not serve cache after a definitive session authorization failure", async () => {
    mockRead.mockResolvedValue({
      messages: [msg("cached")],
      authoritativeMessageIds: ["cached"],
      cachedAt: Date.now(),
    });
    mockAuthorize.mockRejectedValue(
      new FakeTargetError(404, "Session not found"),
    );

    const response = await get({ sessionId: "s1", workspaceId: "ws-1" });

    expect(response.status).toBe(404);
  });

  it("serves tenant cache when OpenCode target startup is unavailable", async () => {
    mockResolve.mockRejectedValue(
      new FakeTargetError(503, "OpenCode server unavailable"),
    );
    mockRead.mockResolvedValue({
      messages: [msg("cached")],
      authoritativeMessageIds: ["cached"],
      cachedAt: Date.now(),
    });

    const response = await get({ sessionId: "s1", workspaceId: "ws-1" });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.source).toBe("stale-cache");
    expect(body.messages[0].info.id).toBe("cached");
  });

  it("returns target startup failure when no recovery data exists", async () => {
    mockResolve.mockRejectedValue(
      new FakeTargetError(503, "OpenCode server unavailable"),
    );
    mockRead.mockResolvedValue(null);

    const response = await get({ sessionId: "s1", workspaceId: "ws-1" });

    expect(response.status).toBe(503);
  });

  it("merges recovered messages into the display window", async () => {
    mockRead.mockResolvedValue({
      messages: [msg("a", undefined, 10), msg("c", undefined, 30)],
      authoritativeMessageIds: ["a", "c"],
      cachedAt: Date.now(),
    });
    mockReadRecovered.mockResolvedValue([
      { sequence: 1, message: msg("b", undefined, 20) },
    ]);

    const res = await get({ sessionId: "s1", workspaceId: "ws-1" });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.total).toBe(3);
    expect(
      body.messages.map((message: { info: { id: string } }) => message.info.id),
    ).toEqual(["a", "b", "c"]);
    expect(body.recoveredMessageIds).toEqual(["b"]);
    expect(mockReadRecovered).toHaveBeenCalledWith("user-1", "ws-1", "s1");
  });

  it("truncates recovered tool output before returning it", async () => {
    mockRead.mockResolvedValue({
      messages: [msg("a", undefined, 10)],
      authoritativeMessageIds: ["a"],
      cachedAt: Date.now(),
    });
    mockReadRecovered.mockResolvedValue([
      { sequence: 1, message: msg("b", "x".repeat(10_000), 20) },
    ]);

    const res = await get({ sessionId: "s1", workspaceId: "ws-1" });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.messages[1].parts[0].state.output).toHaveLength(2000);
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
    expect(mockWriteRecovered).toHaveBeenCalledWith({
      userId: "user-1",
      workspaceId: "ws-1",
      sessionId: "s1",
      messages: expect.arrayContaining([
        expect.objectContaining({ info: expect.objectContaining({ id: "a" }) }),
      ]),
    });
  });

  it("returns live messages when cache persistence fails", async () => {
    mockRead.mockResolvedValue(null);
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify([msg("live")]), { status: 200 }),
    );
    mockWrite.mockRejectedValue(new Error("database busy"));

    const response = await get({ sessionId: "s1", workspaceId: "ws-1" });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.source).toBe("remote");
    expect(body.messages[0].info.id).toBe("live");
  });

  it("requests a bounded tail window from OpenCode instead of the whole history", async () => {
    mockRead.mockResolvedValue(null);
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify([msg("a")]), { status: 200 }),
    );

    await get({ sessionId: "s1", workspaceId: "ws-1" });

    const requestedUrl = new URL(mockFetch.mock.calls[0][0] as string);
    expect(requestedUrl.searchParams.get("limit")).toBe("150");
  });

  it("sizes the upstream window to reach past a load-older anchor", async () => {
    mockRead.mockResolvedValue({
      messages: [msg("a"), msg("b"), msg("c"), msg("d"), msg("e")],
      authoritativeMessageIds: ["a", "b", "c", "d", "e"],
      cachedAt: Date.now() - 120_000,
    });
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify([msg("d"), msg("e")]), { status: 200 }),
    );

    const res = await get({
      sessionId: "s1",
      workspaceId: "ws-1",
      before: "d",
      limit: "2",
    });

    expect(res.status).toBe(200);
    const requestedUrl = new URL(mockFetch.mock.calls[0][0] as string);
    expect(requestedUrl.searchParams.get("limit")).toBe("54");
  });

  it("still reports older history when OpenCode fills the requested window", async () => {
    mockRead.mockResolvedValue(null);
    const window = Array.from({ length: 54 }, (_, index) =>
      msg(`m${index}`, undefined, index + 1),
    );
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify(window), { status: 200 }),
    );

    const res = await get({
      sessionId: "s1",
      workspaceId: "ws-1",
      before: "m0",
      limit: "2",
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.messages).toEqual([]);
    expect(body.hasMore).toBe(true);
  });

  it("reports no older history when OpenCode returns less than the window", async () => {
    mockRead.mockResolvedValue(null);
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify([msg("a"), msg("b")]), { status: 200 }),
    );

    const res = await get({ sessionId: "s1", workspaceId: "ws-1" });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.hasMore).toBe(false);
  });

  it("windows before an anchor for load-older", async () => {
    mockRead.mockResolvedValue({
      messages: [msg("a"), msg("b"), msg("c"), msg("d"), msg("e")],
      authoritativeMessageIds: ["a", "b", "c", "d", "e"],
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
      authoritativeMessageIds: ["a", "b"],
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
      authoritativeMessageIds: ["a", "b"],
      cachedAt: Date.now() - 999_999,
    });
    mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));

    const res = await get({ sessionId: "s1", workspaceId: "ws-1" });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.source).toBe("stale-cache");
    expect(body.messages).toHaveLength(2);
  });

  it("serves recovered history when OpenCode and normal cache are unavailable", async () => {
    mockRead.mockResolvedValue(null);
    mockReadRecovered.mockResolvedValue([
      { sequence: 1, message: msg("recovered", undefined, 10) },
    ]);
    mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));

    const res = await get({ sessionId: "s1", workspaceId: "ws-1" });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.source).toBe("stale-cache");
    expect(body.total).toBe(1);
    expect(body.messages[0].info.id).toBe("recovered");
  });

  it("preserves cached history when OpenCode returns fewer messages", async () => {
    mockRead.mockResolvedValue({
      messages: [msg("a"), msg("b"), msg("c")],
      authoritativeMessageIds: ["a", "b", "c"],
      cachedAt: Date.now() - 999_999,
    });
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify([msg("c")]), { status: 200 }),
    );

    const res = await get({ sessionId: "s1", workspaceId: "ws-1" });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.source).toBe("remote");
    expect(
      body.messages.map((message: { info: { id: string } }) => message.info.id),
    ).toEqual(["a", "b", "c"]);
    expect(mockWrite).toHaveBeenCalledWith({
      userId: "user-1",
      sessionId: "s1",
      workspaceId: "ws-1",
      authoritativeMessageIds: ["c"],
      messages: expect.arrayContaining([
        expect.objectContaining({
          info: expect.objectContaining({ id: "a" }),
        }),
      ]),
    });
  });

  it("returns 504 on upstream timeout with no cache to fall back on", async () => {
    mockRead.mockResolvedValue(null);
    mockFetch.mockRejectedValue(
      new DOMException("Header timeout", "TimeoutError"),
    );

    const res = await get({ sessionId: "s1", workspaceId: "ws-1" });
    expect(res.status).toBe(504);
  });

  it("purges archived history for an explicit removal", async () => {
    mockPurgeHistory.mockReturnValue(3);

    const res = await del({
      sessionId: "s1",
      workspaceId: "ws-1",
      from: "msg-anchor",
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.purged).toBe(3);
    expect(mockPurgeHistory).toHaveBeenCalledWith({
      userId: "user-1",
      workspaceId: "ws-1",
      sessionId: "s1",
      fromMessageId: "msg-anchor",
      exactMessageId: undefined,
    });
  });

  it("rejects a purge that omits the workspace", async () => {
    const res = await del({ sessionId: "s1" });

    expect(res.status).toBe(400);
    expect(mockPurgeHistory).not.toHaveBeenCalled();
  });

  it("purges one removed message without deleting its tail", async () => {
    mockPurgeHistory.mockReturnValue(1);

    const res = await del({
      sessionId: "s1",
      workspaceId: "ws-1",
      message: "msg-one",
    });

    expect(res.status).toBe(200);
    expect(mockPurgeHistory).toHaveBeenCalledWith({
      userId: "user-1",
      workspaceId: "ws-1",
      sessionId: "s1",
      fromMessageId: undefined,
      exactMessageId: "msg-one",
    });
  });
});

// @vitest-environment node
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/drizzle/schema";

const state = vi.hoisted(() => ({
  db: undefined as unknown,
  engines: new Map<string, "opencode" | "omo">(),
}));

const mockAuth = vi.fn();
vi.mock("@/lib/auth/config", () => ({ auth: mockAuth }));
vi.mock("@/lib/db", () => ({
  get db() {
    return state.db;
  },
}));

const mockGetOrStartServer = vi.fn(async () => ({ url: "http://opencode" }));
vi.mock("@/lib/opencode/server-pool", () => ({
  getOrStartServer: mockGetOrStartServer,
  stopServer: vi.fn(),
}));

vi.mock("@/lib/engine/resolve-engine", () => ({
  resolveWorkspaceEngine: vi.fn(
    async (_userId: string, workspaceId: string | null) =>
      (workspaceId && state.engines.get(workspaceId)) ?? "opencode",
  ),
}));

const mockResolveOpenCodeTarget = vi.fn();
vi.mock("@/lib/opencode/proxy-target", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/opencode/proxy-target")>();
  mockResolveOpenCodeTarget.mockImplementation(actual.resolveOpenCodeTarget);
  return {
    ...actual,
    resolveOpenCodeTarget: (userId: string, workspaceId: string | null) =>
      mockResolveOpenCodeTarget(userId, workspaceId),
  };
});

const mockHandleOmoRead = vi.fn();
const mockHandleOmoWrite = vi.fn();
vi.mock("@/lib/omo/facade/read", () => ({
  handleOmoRead: (request: unknown) => mockHandleOmoRead(request),
}));
vi.mock("@/lib/omo/facade/write", () => ({
  handleOmoWrite: (request: unknown) => mockHandleOmoWrite(request),
}));

vi.mock("@/lib/omo/agent-dir", () => ({
  resolveOmoAgentDir: () => "/tmp/devhub-omo-dispatch-agent",
  resolveOmoSocketPath: () => "/tmp/devhub-omo-dispatch-agent/none.sock",
}));

type ExecCallback = (
  error: Error | null,
  stdout: string,
  stderr: string,
) => void;
const mockExecFile = vi.fn(
  (
    _bin: string,
    _args: string[],
    _options: unknown,
    callback: ExecCallback,
  ) => {
    callback(
      null,
      JSON.stringify({
        socket: "/tmp/devhub-omo-dispatch-agent/none.sock",
        pid: 1,
        instanceId: "instance",
        engineVersion: "1",
        action: "attached",
      }),
      "",
    );
  },
);
vi.mock("node:child_process", () => ({
  execFile: (...args: Parameters<typeof mockExecFile>) => mockExecFile(...args),
}));

const USER = "user-1";
const OMO_WS = "ws-omo";
const OC_WS = "ws-oc";

function msg(id: string, sessionID: string, created: number) {
  return {
    info: {
      id,
      sessionID,
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
    parts: [
      { id: `p-${id}`, sessionID, messageID: id, type: "text", text: id },
    ],
  };
}

let sqlite: Database.Database;

function seedCache(workspaceId: string, sessionId: string, ids: string[]) {
  sqlite
    .prepare(
      `INSERT INTO cached_messages (session_id, workspace_id, user_id,
        messages_json, authoritative_message_ids_json, cached_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      sessionId,
      workspaceId,
      USER,
      JSON.stringify(ids.map((id, index) => msg(id, sessionId, index * 10))),
      JSON.stringify(ids),
      Date.now(),
    );
}

function seedRecovered(workspaceId: string, sessionId: string, id: string) {
  sqlite
    .prepare(
      `INSERT INTO recovered_messages (session_id, workspace_id, user_id,
        message_id, sequence, message_json, recovered_at)
       VALUES (?, ?, ?, ?, 1, ?, ?)`,
    )
    .run(
      sessionId,
      workspaceId,
      USER,
      id,
      JSON.stringify(msg(id, sessionId, 15)),
      Date.now(),
    );
}

function cachedIds(workspaceId: string, sessionId: string): string[] | null {
  const row = sqlite
    .prepare(
      "SELECT messages_json FROM cached_messages WHERE workspace_id = ? AND session_id = ?",
    )
    .get(workspaceId, sessionId) as { messages_json: string } | undefined;
  if (!row) return null;
  const messages = JSON.parse(row.messages_json) as { info: { id: string } }[];
  return messages.map((message) => message.info.id);
}

function ids(body: { messages: { info: { id: string } }[] }): string[] {
  return body.messages.map((message) => message.info.id);
}

function request(
  path: string,
  init?: ConstructorParameters<typeof NextRequest>[1],
) {
  return new NextRequest(`http://localhost:3000${path}`, init);
}

beforeEach(() => {
  vi.clearAllMocks();
  sqlite = new Database(":memory:");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: "drizzle/migrations" });
  state.db = db;
  sqlite
    .prepare("INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)")
    .run(USER, "user", "hash");
  for (const [id, path] of [
    [OMO_WS, "/tmp/omo-workspace"],
    [OC_WS, "/tmp/oc-workspace"],
  ]) {
    sqlite
      .prepare(
        "INSERT INTO workspaces (id, user_id, name, path, type) VALUES (?, ?, ?, ?, 'repo')",
      )
      .run(id, USER, id, path);
  }
  state.engines = new Map([
    [OMO_WS, "omo"],
    [OC_WS, "opencode"],
  ]);
  mockAuth.mockResolvedValue({ user: { id: USER } });
  mockHandleOmoRead.mockImplementation(async () => Response.json([]));
  mockHandleOmoWrite.mockImplementation(
    async () => new Response(null, { status: 204 }),
  );
  globalThis.__devhubOmoDaemon = undefined;
});

afterEach(async () => {
  vi.unstubAllGlobals();
  const { disposeOmoRuntime } = await import("@/lib/omo/session-registry");
  disposeOmoRuntime("/tmp/devhub-omo-dispatch-agent/none.sock");
  sqlite.close();
});

describe("opencode proxy dispatch", () => {
  it("routes omo reads to the facade without starting OpenCode", async () => {
    const { GET } = await import("@/app/api/opencode/[...path]/route");
    const response = await GET(
      request(
        `/api/opencode/session/omo_x/message?workspaceId=${OMO_WS}&limit=5`,
      ),
      { params: Promise.resolve({ path: ["session", "omo_x", "message"] }) },
    );

    expect(response.status).toBe(200);
    expect(mockHandleOmoRead).toHaveBeenCalledOnce();
    const call = mockHandleOmoRead.mock.calls[0]?.[0];
    expect(call.path).toBe("/session/omo_x/message");
    expect(call.workspace).toMatchObject({
      id: OMO_WS,
      path: "/tmp/omo-workspace",
    });
    expect(call.query.get("limit")).toBe("5");
    expect(call.query.has("workspaceId")).toBe(false);
    expect(mockGetOrStartServer).not.toHaveBeenCalled();
    expect(mockResolveOpenCodeTarget).not.toHaveBeenCalled();
  });

  it("routes omo writes to the facade with the parsed body", async () => {
    const { POST } = await import("@/app/api/opencode/[...path]/route");
    const response = await POST(
      request(
        `/api/opencode/session/omo_x/prompt_async?workspaceId=${OMO_WS}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ parts: [{ type: "text", text: "hi" }] }),
        },
      ),
      {
        params: Promise.resolve({ path: ["session", "omo_x", "prompt_async"] }),
      },
    );

    expect(response.status).toBe(204);
    expect(mockHandleOmoWrite.mock.calls[0]?.[0]).toMatchObject({
      method: "POST",
      path: "/session/omo_x/prompt_async",
      body: { parts: [{ type: "text", text: "hi" }] },
    });
    expect(mockGetOrStartServer).not.toHaveBeenCalled();
    expect(mockResolveOpenCodeTarget).not.toHaveBeenCalled();
  });

  it("rejects OpenCode session ids under omo", async () => {
    const { GET } = await import("@/app/api/opencode/[...path]/route");
    const response = await GET(
      request(`/api/opencode/session/ses_abc?workspaceId=${OMO_WS}`),
      { params: Promise.resolve({ path: ["session", "ses_abc"] }) },
    );

    expect(response.status).toBe(404);
    expect(mockHandleOmoRead).not.toHaveBeenCalled();
  });

  it("rejects omo session ids under opencode before any target resolution", async () => {
    const { GET } = await import("@/app/api/opencode/[...path]/route");
    const response = await GET(
      request(`/api/opencode/session/omo_x?workspaceId=${OC_WS}`),
      { params: Promise.resolve({ path: ["session", "omo_x"] }) },
    );

    expect(response.status).toBe(404);
    expect(mockResolveOpenCodeTarget).not.toHaveBeenCalled();
  });

  it("keeps the OpenCode path for opencode workspaces", async () => {
    const fetchMock = vi.fn(async (_url: unknown, _init?: RequestInit) =>
      Response.json([{ id: "ses_1" }]),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { GET } = await import("@/app/api/opencode/[...path]/route");
    const response = await GET(
      request(`/api/opencode/session?workspaceId=${OC_WS}`),
      { params: Promise.resolve({ path: ["session"] }) },
    );

    expect(response.status).toBe(200);
    expect(mockResolveOpenCodeTarget).toHaveBeenCalledWith(USER, OC_WS);
    expect(mockGetOrStartServer).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "http://opencode/session?directory=%2Ftmp%2Foc-workspace",
    );
    expect(mockHandleOmoRead).not.toHaveBeenCalled();
  });
});

describe("events dispatch", () => {
  it("merges omo and opencode streams and releases both on cancel", async () => {
    const { getOmoReadRuntime, getOmoDialogLedger } =
      await import("@/lib/omo/facade/read-runtime");
    const runtime = getOmoReadRuntime();
    getOmoDialogLedger(runtime).register({
      routingHandle: "route-1",
      durableId: "x",
      workspaceId: OMO_WS,
      extUiId: "ext-1",
      method: "question",
      request: { sessionID: "omo_x", questions: [] },
    });
    const subscribersBefore = runtime.registry.subscriberCount(OMO_WS);
    const listenersBefore = runtime.client.listenerCount();

    let upstreamSignal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init?: RequestInit) => {
        upstreamSignal = init?.signal ?? undefined;
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(
                new TextEncoder().encode('data: {"type":"oc-event"}\n\n'),
              );
            },
          }),
        );
      }),
    );

    const { GET } = await import("@/app/api/opencode/events/route");
    const response = await GET(
      request(
        `/api/opencode/events?workspaceIds=${OMO_WS},${OC_WS}&engineRev=7`,
      ),
    );
    expect(response.status).toBe(200);
    expect(runtime.registry.subscriberCount(OMO_WS)).toBe(
      subscribersBefore + 1,
    );

    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    let text = "";
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (
        text.includes(`"workspaceId":"${OMO_WS}"`) &&
        text.includes("oc-event")
      ) {
        break;
      }
      const chunk = await reader?.read();
      if (!chunk || chunk.done) break;
      text += decoder.decode(chunk.value);
    }
    expect(text).toContain(`"workspaceId":"${OMO_WS}"`);
    expect(text).toContain("question.asked");
    expect(text).toContain(`"workspaceId":"${OC_WS}"`);
    expect(text).toContain("oc-event");

    await reader?.cancel();

    expect(runtime.registry.subscriberCount(OMO_WS)).toBe(subscribersBefore);
    expect(runtime.client.listenerCount()).toBe(listenersBefore);
    expect(upstreamSignal?.aborted).toBe(true);
    expect(mockGetOrStartServer).toHaveBeenCalledOnce();
  });
});

describe("events dispatch with an unusable omo workspace", () => {
  const UNTRUSTED_WS = "ws-omo-untrusted";

  beforeEach(() => {
    sqlite
      .prepare(
        `INSERT INTO workspaces (id, user_id, name, path, type, backend, agent_url)
         VALUES (?, ?, ?, '/tmp/remote', 'repo', 'remote', 'http://10.255.255.1:7599')`,
      )
      .run(UNTRUSTED_WS, USER, UNTRUSTED_WS);
    state.engines.set(UNTRUSTED_WS, "omo");
  });

  it("keeps streaming the healthy workspaces when one cannot be set up", async () => {
    const { GET } = await import("@/app/api/opencode/events/route");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const response = await GET(
      request(
        `/api/opencode/events?workspaceIds=${OMO_WS},${UNTRUSTED_WS}&engineRev=1`,
      ),
    );

    expect(response.status).toBe(200);
    expect(warn).toHaveBeenCalledWith(
      "[events] skipping OmO workspace",
      UNTRUSTED_WS,
      expect.any(Error),
    );
    await response.body?.cancel();
  });

  it("still returns 503 when no requested workspace can stream", async () => {
    const { GET } = await import("@/app/api/opencode/events/route");
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const response = await GET(
      request(`/api/opencode/events?workspaceIds=${UNTRUSTED_WS}&engineRev=1`),
    );

    expect(response.status).toBe(503);
  });
});

describe("restart dispatch", () => {
  it("re-ensures and reconnects omo without stopping the daemon", async () => {
    const { getOmoReadRuntime } = await import("@/lib/omo/facade/read-runtime");
    const reconnect = vi
      .spyOn(getOmoReadRuntime().client, "reconnect")
      .mockResolvedValue({
        protocolVersion: 1,
        mode: "multi",
        capabilities: [],
      });
    const { POST } = await import("@/app/api/opencode/restart/route");
    const response = await POST(
      request(`/api/opencode/restart?workspaceId=${OMO_WS}`, {
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ restarted: true, target: "omo" });
    expect(reconnect).toHaveBeenCalledOnce();
    expect(mockExecFile).toHaveBeenCalledWith(
      expect.any(String),
      ["daemon", "run", "--json"],
      expect.anything(),
      expect.any(Function),
    );
    for (const call of mockExecFile.mock.calls) {
      expect(call[1]).not.toContain("stop");
    }
  });
});

describe("session history dispatch", () => {
  it("deletes nothing for a provisional omo message", async () => {
    seedCache(OMO_WS, "omo_x", ["omo_live_1", "omo_2"]);
    const { DELETE } = await import("@/app/api/sessions/messages/route");
    const response = await DELETE(
      request(
        `/api/sessions/messages?workspaceId=${OMO_WS}&sessionId=omo_x&message=omo_live_1`,
        { method: "DELETE" },
      ),
    );

    expect(response.status).toBe(200);
    expect(cachedIds(OMO_WS, "omo_x")).toEqual(["omo_live_1", "omo_2"]);
    expect(mockGetOrStartServer).not.toHaveBeenCalled();
    expect(mockResolveOpenCodeTarget).not.toHaveBeenCalled();
  });

  it("clears the cache for an omo session", async () => {
    seedCache(OMO_WS, "omo_x", ["omo_1"]);
    const { DELETE } = await import("@/app/api/sessions/cache/route");
    const response = await DELETE(
      request(`/api/sessions/cache?workspaceId=${OMO_WS}&sessionId=omo_x`, {
        method: "DELETE",
      }),
    );

    expect(response.status).toBe(200);
    expect(cachedIds(OMO_WS, "omo_x")).toBeNull();
    expect(mockGetOrStartServer).not.toHaveBeenCalled();
  });

  it("replaces omo history with the facade window", async () => {
    seedCache(OMO_WS, "omo_x", ["omo_stale_1", "omo_stale_2"]);
    seedRecovered(OMO_WS, "omo_x", "omo_recovered_only");
    mockHandleOmoRead.mockImplementation(async () =>
      Response.json([msg("omo_1", "omo_x", 100), msg("omo_2", "omo_x", 200)]),
    );
    const { GET } = await import("@/app/api/sessions/messages/route");
    const response = await GET(
      request(
        `/api/sessions/messages?workspaceId=${OMO_WS}&sessionId=omo_x&replace=1`,
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(ids(body)).toEqual(["omo_1", "omo_2"]);
    expect(body.recoveredMessageIds).toEqual([]);
    expect(cachedIds(OMO_WS, "omo_x")).toEqual(["omo_1", "omo_2"]);
    expect(mockHandleOmoRead.mock.calls[0]?.[0].path).toBe(
      "/session/omo_x/message",
    );
    expect(mockGetOrStartServer).not.toHaveBeenCalled();
    expect(mockResolveOpenCodeTarget).not.toHaveBeenCalled();
  });

  it("never merges recovered messages for omo without replace", async () => {
    seedRecovered(OMO_WS, "omo_x", "omo_recovered_only");
    mockHandleOmoRead.mockImplementation(async () =>
      Response.json([msg("omo_1", "omo_x", 100)]),
    );
    const { GET } = await import("@/app/api/sessions/messages/route");
    const response = await GET(
      request(`/api/sessions/messages?workspaceId=${OMO_WS}&sessionId=omo_x`),
    );
    const body = await response.json();

    expect(ids(body)).toEqual(["omo_1"]);
    expect(body.recoveredMessageIds).toEqual([]);
  });

  it("ignores replace for opencode and still merges recovered messages", async () => {
    seedCache(OC_WS, "ses_1", ["a", "c"]);
    seedRecovered(OC_WS, "ses_1", "b");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ directory: "/tmp/oc-workspace" })),
    );
    const { GET } = await import("@/app/api/sessions/messages/route");
    const response = await GET(
      request(
        `/api/sessions/messages?workspaceId=${OC_WS}&sessionId=ses_1&replace=1`,
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect([...ids(body)].sort()).toEqual(["a", "b", "c"]);
    expect(body.recoveredMessageIds).toEqual(["b"]);
    expect(mockHandleOmoRead).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mockAuth = vi.fn();
vi.mock("@/lib/auth/config", () => ({ auth: () => mockAuth() }));

const mockResolveEngine = vi.fn();
vi.mock("@/lib/engine/resolve-engine", () => ({
  resolveWorkspaceEngine: (...args: unknown[]) => mockResolveEngine(...args),
}));

class FakeTargetError extends Error {
  constructor(
    public status: number,
    message: string,
    public detail?: string,
  ) {
    super(message);
  }
}
const mockResolveTarget = vi.fn();
const mockAuthorize = vi.fn();
const mockResolveOmoWorkspace = vi.fn();
vi.mock("@/lib/opencode/proxy-target", () => ({
  resolveOpenCodeTarget: (...args: unknown[]) => mockResolveTarget(...args),
  authorizeOpenCodeSession: (...args: unknown[]) => mockAuthorize(...args),
  resolveOmoWorkspace: (...args: unknown[]) => mockResolveOmoWorkspace(...args),
  OpenCodeTargetError: FakeTargetError,
}));

const mockFetch = vi.fn();
vi.mock("@/lib/opencode/fetch-timeout", () => ({
  fetchWithHeaderTimeout: (...args: unknown[]) => mockFetch(...args),
}));

const mockHandleOmoRead = vi.fn();
vi.mock("@/lib/omo/facade/read", () => ({
  handleOmoRead: (...args: unknown[]) => mockHandleOmoRead(...args),
}));
vi.mock("@/lib/omo/route-dispatch", () => ({
  toOmoWorkspace: (workspace: { id: string; path: string }) => ({
    id: workspace.id,
    path: workspace.path,
  }),
}));

const mockWriteFile = vi.fn();
vi.mock("@/lib/workspaces/backend", () => ({
  getBackend: () => ({
    writeFile: (...args: unknown[]) => mockWriteFile(...args),
  }),
}));

const WORKSPACE = { id: "ws-1", path: "/repo", backend: "local" };
const SESSION_INFO = {
  id: "ses_1",
  title: "Fix the build",
  time: { created: 1_000, updated: 2_000 },
};
const SAVE_REQUEST = {
  workspaceId: "ws-1",
  sessionId: "ses_1",
  filename: "session-ses_1.md",
  thinking: true,
  toolDetails: true,
  assistantMetadata: true,
  openWithoutSaving: false,
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function userMessage(
  sessionID: string,
  id: string,
  created: number,
  text: string,
) {
  return {
    info: {
      id,
      sessionID,
      role: "user",
      time: { created },
      agent: "build",
      model: { providerID: "anthropic", modelID: "claude-x" },
    },
    parts: [{ id: `${id}-text`, sessionID, messageID: id, type: "text", text }],
  };
}

function toolMessage(id: string, created: number, output: string) {
  return {
    info: {
      id,
      sessionID: "ses_1",
      role: "assistant",
      parentID: "msg_1",
      modelID: "claude-x",
      providerID: "anthropic",
      mode: "build",
      path: { cwd: "/repo", root: "/repo" },
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
      {
        id: `${id}-tool`,
        sessionID: "ses_1",
        messageID: id,
        type: "tool",
        callID: `call-${id}`,
        tool: "bash",
        state: {
          status: "completed",
          input: { command: "cat build.log" },
          output,
          title: "bash",
          metadata: {},
          time: { start: 1, end: 2 },
        },
      },
    ],
  };
}

function serveOpenCode(messages: unknown[]) {
  mockFetch.mockImplementation(async (url: string) => {
    const { pathname } = new URL(url);
    if (pathname === "/session/ses_1") return json(SESSION_INFO);
    if (pathname === "/session/ses_1/message") return json(messages);
    if (pathname === "/config/providers") {
      return json({
        providers: [
          { id: "anthropic", models: { "claude-x": { name: "Claude X" } } },
        ],
      });
    }
    return json({ error: "not found" }, 404);
  });
}

async function postExport(body: Record<string, unknown>) {
  const { POST } = await import("@/app/api/sessions/export/route");
  return POST(
    new NextRequest("http://localhost:3000/api/sessions/export", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { id: "user-1" } });
  mockResolveEngine.mockResolvedValue("opencode");
  mockResolveTarget.mockResolvedValue({
    serverUrl: "http://127.0.0.1:4096",
    directory: "/repo",
    workspace: WORKSPACE,
  });
  mockAuthorize.mockResolvedValue(undefined);
  mockWriteFile.mockResolvedValue(undefined);
});

describe("POST /api/sessions/export", () => {
  it("rejects unauthenticated requests", async () => {
    mockAuth.mockResolvedValue(null);

    const response = await postExport(SAVE_REQUEST);

    expect(response.status).toBe(401);
  });

  it("asks OpenCode for the whole history instead of a window", async () => {
    serveOpenCode([userMessage("ses_1", "msg_1", 1, "hi")]);

    await postExport(SAVE_REQUEST);

    const historyUrls = mockFetch.mock.calls
      .map(([url]) => new URL(String(url)))
      .filter((url) => url.pathname === "/session/ses_1/message");
    expect(historyUrls.map((url) => url.searchParams.has("limit"))).toEqual([
      false,
    ]);
  });

  it("saves the transcript with untruncated tool output to the workspace", async () => {
    const longOutput = "x".repeat(5_000);
    serveOpenCode([
      userMessage("ses_1", "msg_1", 1, "Why is the build red?"),
      toolMessage("msg_2", 2, longOutput),
    ]);

    const response = await postExport({
      ...SAVE_REQUEST,
      filename: "  exports/session-ses_1.md  ",
    });

    expect(await response.json()).toEqual({
      path: "exports/session-ses_1.md",
    });
    expect(mockWriteFile).toHaveBeenCalledWith(
      "exports/session-ses_1.md",
      expect.stringContaining(`**Output:**\n\`\`\`\n${longOutput}\n\`\`\``),
    );
  });

  it("returns the transcript for preview without writing a file", async () => {
    serveOpenCode([userMessage("ses_1", "msg_1", 1, "Why is the build red?")]);

    const response = await postExport({
      ...SAVE_REQUEST,
      filename: "",
      openWithoutSaving: true,
    });

    const body: { markdown: string } = await response.json();
    expect(body.markdown).toContain("## User\n\nWhy is the build red?\n\n");
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it("refuses previews larger than the file viewer limit", async () => {
    serveOpenCode([toolMessage("msg_2", 2, "x".repeat(6 * 1024 * 1024))]);

    const response = await postExport({
      ...SAVE_REQUEST,
      openWithoutSaving: true,
    });

    expect(response.status).toBe(413);
  });

  it("requires a filename when saving", async () => {
    const response = await postExport({ ...SAVE_REQUEST, filename: "   " });

    expect(response.status).toBe(400);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("reports an upstream history failure as 502 without writing", async () => {
    mockFetch.mockImplementation(async (url: string) =>
      new URL(url).pathname === "/session/ses_1/message"
        ? json({ error: "boom" }, 500)
        : json(SESSION_INFO),
    );

    const response = await postExport(SAVE_REQUEST);

    expect(response.status).toBe(502);
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it("maps a filename outside the workspace to 403", async () => {
    serveOpenCode([userMessage("ses_1", "msg_1", 1, "hi")]);
    mockWriteFile.mockRejectedValue(new Error("Path traversal denied"));

    const response = await postExport({
      ...SAVE_REQUEST,
      filename: "../outside.md",
    });

    expect(response.status).toBe(403);
  });

  it("pages omo history past the facade's 1,000-message window", async () => {
    mockResolveEngine.mockResolvedValue("omo");
    mockResolveOmoWorkspace.mockResolvedValue(WORKSPACE);
    const history = Array.from({ length: 1_003 }, (_, index) =>
      userMessage("omo_1", `msg_${index}`, index + 1, `message ${index}`),
    );
    // Behaves like the omo facade: the newest `limit` messages before `before`.
    mockHandleOmoRead.mockImplementation(
      async ({ path, query }: { path: string; query: URLSearchParams }) => {
        if (path === "/session/omo_1") {
          return json({ ...SESSION_INFO, id: "omo_1" });
        }
        if (path === "/config/providers") return json({ providers: [] });
        if (path !== "/session/omo_1/message") return json({}, 404);
        const before = query.get("before");
        const end = before
          ? history.findIndex((message) => message.info.id === before)
          : history.length;
        const limit = Number(query.get("limit"));
        return json(history.slice(Math.max(0, end - limit), end));
      },
    );

    await postExport({ ...SAVE_REQUEST, sessionId: "omo_1" });

    const transcript = String(mockWriteFile.mock.calls[0]?.[1]);
    expect(transcript.match(/^## User$/gm)).toHaveLength(1_003);
  });
});

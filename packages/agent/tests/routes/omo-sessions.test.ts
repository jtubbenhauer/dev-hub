import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const execFileMock = vi.fn();

vi.mock("node:child_process", () => ({
  execFile: (...args: unknown[]) => execFileMock(...args),
}));

const TOKEN = "test-agent-token";

type ExecFileCallback = (
  error: (Error & { code?: number }) | null,
  stdout: string,
  stderr: string,
) => void;

function respondWith(exitCode: number, stdout: string, stderr = ""): void {
  execFileMock.mockImplementationOnce(
    (
      _bin: string,
      _args: string[],
      _options: unknown,
      callback: ExecFileCallback,
    ) => {
      if (exitCode === 0) {
        callback(null, stdout, stderr);
        return;
      }
      const error = new Error(`exit ${exitCode}`) as Error & {
        code?: number;
      };
      error.code = exitCode;
      callback(error, stdout, stderr);
    },
  );
}

describe("omoSessionRoutes", () => {
  let workspacePath: string;
  let agentDir: string;

  beforeEach(async () => {
    process.env.DEVHUB_AGENT_TOKEN = TOKEN;
    workspacePath = await mkdtemp(join(tmpdir(), "devhub-agent-ws-"));
    agentDir = await mkdtemp(join(tmpdir(), "devhub-agent-dir-"));
    process.env.OMO_CODING_AGENT_DIR = agentDir;
    execFileMock.mockReset();
  });

  afterEach(async () => {
    delete process.env.DEVHUB_AGENT_TOKEN;
    delete process.env.OMO_CODING_AGENT_DIR;
    await rm(workspacePath, { recursive: true, force: true });
    await rm(agentDir, { recursive: true, force: true });
    vi.resetModules();
  });

  async function loadApp() {
    const { omoSessionRoutes } =
      await import("../../src/routes/omo-sessions.js");
    return omoSessionRoutes(workspacePath);
  }

  const protectedRoutes: Array<{
    method: "GET" | "POST" | "DELETE";
    path: string;
  }> = [
    { method: "POST", path: "/daemon/ensure" },
    { method: "GET", path: "/daemon/status" },
    { method: "GET", path: "/realpath" },
    { method: "GET", path: "/sessions" },
    { method: "GET", path: "/sessions/some-id/entries" },
    { method: "DELETE", path: "/sessions/some-id" },
  ];

  for (const route of protectedRoutes) {
    it(`returns 401 for ${route.method} ${route.path} with a missing token`, async () => {
      const app = await loadApp();
      const response = await app.request(route.path, { method: route.method });
      expect(response.status).toBe(401);
    });

    it(`returns 401 for ${route.method} ${route.path} with the wrong token`, async () => {
      const app = await loadApp();
      const response = await app.request(route.path, {
        method: route.method,
        headers: { Authorization: "Bearer wrong-token" },
      });
      expect(response.status).toBe(401);
    });
  }

  it("GET /realpath returns the realpath of the workspace", async () => {
    const app = await loadApp();
    const response = await app.request("/realpath", {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ path: await realpath(workspacePath) });
  });

  it("GET /sessions/:id/entries returns 404 for an id not present in the listing, including path-traversal-shaped ids", async () => {
    const app = await loadApp();
    const response = await app.request("/sessions/../../etc/passwd/entries", {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(response.status).toBe(404);
  });

  it("DELETE /sessions/:id returns 404 for an id not present in the listing", async () => {
    const app = await loadApp();
    const response = await app.request("/sessions/does-not-exist", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(response.status).toBe(404);
  });

  it("GET /sessions/:id/entries resolves a real id through the listing and returns entries", async () => {
    const encoded = (await import("../../src/omo/sessions.js")).encodeCwdDir(
      workspacePath,
    );
    const sessionsDir = join(agentDir, "sessions", `--${encoded}--`);
    await mkdir(sessionsDir, { recursive: true });
    const sessionPath = join(sessionsDir, "session.jsonl");
    await writeFile(
      sessionPath,
      [
        JSON.stringify({
          type: "session",
          version: 3,
          id: "session-real",
          timestamp: "2024-01-01T00:00:00.000Z",
          cwd: workspacePath,
        }),
        JSON.stringify({
          type: "message",
          id: "entry-1",
          parentId: null,
          timestamp: "2024-01-01T00:01:00.000Z",
          message: { role: "user", content: "hi" },
        }),
      ].join("\n") + "\n",
    );

    const app = await loadApp();
    const listResponse = await app.request("/sessions", {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(listResponse.status).toBe(200);
    const summaries = await listResponse.json();
    expect(summaries).toHaveLength(1);
    expect(summaries[0].durableId).toBe("session-real");

    const entriesResponse = await app.request(
      "/sessions/session-real/entries",
      { headers: { Authorization: `Bearer ${TOKEN}` } },
    );
    expect(entriesResponse.status).toBe(200);
    const entries = await entriesResponse.json();
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe("entry-1");

    const deleteResponse = await app.request("/sessions/session-real", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(deleteResponse.status).toBe(200);
  });

  it("POST /daemon/ensure maps the daemon's exit codes to HTTP responses", async () => {
    const app = await loadApp();

    respondWith(
      0,
      `${JSON.stringify({
        socket: "/tmp/rpc.sock",
        pid: 42,
        instanceId: "instance",
        engineVersion: "1.0.0",
        action: "started",
      })}\n`,
    );
    const ok = await app.request("/daemon/ensure", {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(ok.status).toBe(200);

    respondWith(2, "");
    const usage = await app.request("/daemon/ensure", {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(usage.status).toBe(400);

    respondWith(3, "");
    const notRunning = await app.request("/daemon/ensure", {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(notRunning.status).toBe(503);

    respondWith(4, "");
    const unsupported = await app.request("/daemon/ensure", {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(unsupported.status).toBe(501);

    respondWith(5, "", "boom");
    const refused = await app.request("/daemon/ensure", {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(refused.status).toBe(502);
  });

  it("GET /daemon/status returns reachable:false on exit code 3 without erroring", async () => {
    const app = await loadApp();
    respondWith(3, "");

    const response = await app.request("/daemon/status", {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ reachable: false });
  });
});

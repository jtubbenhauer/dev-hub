// @vitest-environment node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
// Import the route factory directly; the agent entrypoint starts a server.
import { fileRoutes } from "../../packages/agent/src/routes/files";

const { mockAuth, mockWhere } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockWhere: vi.fn(),
}));

vi.mock("@/lib/auth/config", () => ({ auth: mockAuth }));
vi.mock("@/lib/db", () => ({
  db: { select: () => ({ from: () => ({ where: mockWhere }) }) },
}));

import { POST } from "@/app/api/files/upload/route";
import { MAX_FILE_SIZE } from "@/lib/attachment-utils";

const JSON_CONTENT = '{"name": "Zoë", "items": [1, 2, 3]}\n';
const SAVED_PATH_PATTERN =
  /^\.devhub\/uploads\/\d{8}-\d{6}-[0-9a-f]{6}-payload\.json$/;

const createdDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  createdDirs.push(dir);
  return dir;
}

function workspaceRow(overrides: Record<string, unknown>) {
  return {
    id: "ws-1",
    userId: "user-1",
    name: "repo",
    backend: "local",
    agentUrl: null,
    opencodeUrl: null,
    quickCommands: null,
    providerMeta: null,
    linkedTaskMeta: null,
    ...overrides,
  };
}

function toDataUrl(content: string | Buffer): string {
  return `data:text/plain;base64,${Buffer.from(content).toString("base64")}`;
}

function uploadRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/files/upload", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { id: "user-1" } });
});

afterEach(() => {
  vi.unstubAllGlobals();
  while (createdDirs.length > 0) {
    const dir = createdDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("POST /api/files/upload", () => {
  it("rejects unauthenticated requests", async () => {
    mockAuth.mockResolvedValue(null);

    const response = await POST(
      uploadRequest({
        workspaceId: "ws-1",
        filename: "payload.json",
        dataUrl: toDataUrl("{}"),
      }),
    );

    expect(response.status).toBe(401);
  });

  it.each([
    ["invalid JSON", "{not json"],
    ["a missing filename", { workspaceId: "ws-1", dataUrl: toDataUrl("{}") }],
    [
      "a data URL that is not base64",
      { workspaceId: "ws-1", filename: "a.json", dataUrl: "data:,{}" },
    ],
  ])("rejects %s", async (_label, body) => {
    const response = await POST(uploadRequest(body));

    expect(response.status).toBe(400);
  });

  it("returns 404 for a workspace the user does not own", async () => {
    mockWhere.mockResolvedValue([]);

    const response = await POST(
      uploadRequest({
        workspaceId: "ws-other",
        filename: "payload.json",
        dataUrl: toDataUrl("{}"),
      }),
    );

    expect(response.status).toBe(404);
  });

  it("rejects files over the attachment size limit", async () => {
    const response = await POST(
      uploadRequest({
        workspaceId: "ws-1",
        filename: "payload.json",
        dataUrl: toDataUrl(Buffer.alloc(MAX_FILE_SIZE + 1)),
      }),
    );

    expect(response.status).toBe(413);
  });

  it("saves the file into a local workspace without showing up in git status", async () => {
    const workspaceDir = makeTempDir("upload-route-local-");
    execFileSync("git", ["init", "--quiet"], { cwd: workspaceDir });
    mockWhere.mockResolvedValue([workspaceRow({ path: workspaceDir })]);

    const response = await POST(
      uploadRequest({
        workspaceId: "ws-1",
        filename: "payload.json",
        dataUrl: toDataUrl(JSON_CONTENT),
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.path).toMatch(SAVED_PATH_PATTERN);
    expect(body.sizeBytes).toBe(Buffer.byteLength(JSON_CONTENT));
    expect(fs.readFileSync(path.join(workspaceDir, body.path), "utf8")).toBe(
      JSON_CONTENT,
    );
    const gitStatus = execFileSync(
      "git",
      ["status", "--porcelain", "--untracked-files=all"],
      { cwd: workspaceDir, encoding: "utf8" },
    );
    expect(gitStatus).toBe("");
  });

  it("saves the file into a remote workspace through the agent", async () => {
    const agentWorkspaceDir = makeTempDir("upload-route-remote-");
    const agentFileRoutes = fileRoutes(agentWorkspaceDir);
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input, init) => {
        const url = new URL(input instanceof Request ? input.url : input);
        return agentFileRoutes.request(
          url.pathname.replace(/^\/files/, ""),
          init,
        );
      }),
    );
    mockWhere.mockResolvedValue([
      workspaceRow({
        path: "/home/dev/code",
        backend: "remote",
        agentUrl: "http://agent.test:10020",
        opencodeUrl: "http://opencode.test:15020",
      }),
    ]);

    const response = await POST(
      uploadRequest({
        workspaceId: "ws-1",
        filename: "payload.json",
        dataUrl: toDataUrl(JSON_CONTENT),
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.path).toMatch(SAVED_PATH_PATTERN);
    expect(
      fs.readFileSync(path.join(agentWorkspaceDir, body.path), "utf8"),
    ).toBe(JSON_CONTENT);
    expect(
      fs.readFileSync(
        path.join(agentWorkspaceDir, ".devhub/uploads/.gitignore"),
        "utf8",
      ),
    ).toBe("*\n");
  });

  it("reports the agent's error when the remote write fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(
        async () => new Response("disk full", { status: 500 }),
      ),
    );
    mockWhere.mockResolvedValue([
      workspaceRow({
        path: "/home/dev/code",
        backend: "remote",
        agentUrl: "http://agent.test:10020",
        opencodeUrl: "http://opencode.test:15020",
      }),
    ]);

    const response = await POST(
      uploadRequest({
        workspaceId: "ws-1",
        filename: "payload.json",
        dataUrl: toDataUrl(JSON_CONTENT),
      }),
    );

    expect(response.status).toBe(500);
    expect((await response.json()).error).toContain("disk full");
  });
});

// @vitest-environment node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { parseContentSearchOutcome } from "@devhub/shared";
import type { ContentSearchOutcome } from "@devhub/shared";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  where: vi.fn(),
  eq: vi.fn(),
}));
vi.mock("@/lib/auth/config", () => ({ auth: mocks.auth }));
vi.mock("@/lib/db", () => ({
  db: { select: () => ({ from: () => ({ where: mocks.where }) }) },
}));
vi.mock("@/drizzle/schema", () => ({
  workspaces: { id: "id", userId: "userId" },
}));
vi.mock("drizzle-orm", () => ({ eq: mocks.eq, and: vi.fn() }));
import { GET } from "@/app/api/files/grep/route";

const AGENT_URL = "http://127.0.0.1:7510";

let workspaceRoot: string;

function grepRequest(query: Record<string, string>): NextRequest {
  const url = new URL("http://localhost/api/files/grep");
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value);
  }
  return new NextRequest(url);
}

function remoteRow() {
  return {
    id: "ws",
    userId: "user",
    name: "remote-ws",
    backend: "remote",
    path: "/workspace/repo",
    agentUrl: AGENT_URL,
    opencodeUrl: "http://127.0.0.1:7511",
  };
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function readOkOutcome(response: Response) {
  const outcome = parseContentSearchOutcome(await response.json());
  if (outcome?.kind !== "ok") {
    throw new Error(`expected ok outcome, got ${JSON.stringify(outcome)}`);
  }
  return outcome;
}

beforeEach(() => {
  vi.clearAllMocks();
  workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "api-files-grep-"));
  execFileSync("git", ["-C", workspaceRoot, "init", "--quiet"], {
    stdio: "ignore",
  });
  fs.mkdirSync(path.join(workspaceRoot, "src"), { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, "src/a.ts"), "const needle = 1;\n");
  fs.writeFileSync(path.join(workspaceRoot, "other.txt"), "nothing here\n");
  mocks.auth.mockResolvedValue({ user: { id: "user" } });
  mocks.where.mockResolvedValue([
    { id: "ws", userId: "user", backend: "local", path: workspaceRoot },
  ]);
});

afterEach(() => {
  vi.unstubAllGlobals();
  fs.rmSync(workspaceRoot, { recursive: true, force: true });
});

describe("GET /api/files/grep", () => {
  it("returns 401 when there is no session", async () => {
    mocks.auth.mockResolvedValue(null);

    const response = await GET(
      grepRequest({ workspaceId: "ws", pattern: "needle" }),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });

  it("returns 400 when workspaceId is missing", async () => {
    const response = await GET(grepRequest({ pattern: "needle" }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "workspaceId is required",
    });
  });

  it("returns 400 invalid-pattern for multi-line search text before the workspace lookup", async () => {
    const response = await GET(
      grepRequest({ workspaceId: "ws", pattern: "a\nb" }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      kind: "invalid-pattern",
      message: "Search text must be a single line",
    });
    expect(mocks.where).not.toHaveBeenCalled();
  });

  it("returns 404 when the workspace is not owned by the session user", async () => {
    mocks.where.mockResolvedValue([]);

    const response = await GET(
      grepRequest({ workspaceId: "someone-elses", pattern: "needle" }),
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Workspace not found" });
    expect(mocks.eq).toHaveBeenCalledWith("id", "someone-elses");
    expect(mocks.eq).toHaveBeenCalledWith("userId", "user");
  });

  it("returns 200 with the match for a local workspace", async () => {
    const response = await GET(
      grepRequest({ workspaceId: "ws", pattern: "needle" }),
    );

    expect(response.status).toBe(200);
    const outcome = await readOkOutcome(response);
    expect(outcome.files.map((file) => file.path)).toEqual(["src/a.ts"]);
    expect(outcome.files[0]?.matches[0]).toMatchObject({
      lineNumber: 1,
      startColumn: 7,
      endColumn: 13,
    });
  });

  it("returns 200 with zero results for an empty pattern", async () => {
    const response = await GET(grepRequest({ workspaceId: "ws", pattern: "" }));

    expect(response.status).toBe(200);
    const outcome = await readOkOutcome(response);
    expect(outcome.matchCount).toBe(0);
    expect(outcome.files).toEqual([]);
  });

  it("returns 400 invalid-pattern when the regex does not compile", async () => {
    const response = await GET(
      grepRequest({ workspaceId: "ws", pattern: "(", regex: "1" }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ kind: "invalid-pattern" });
  });

  it("returns 500 failed when the backend cannot be built", async () => {
    mocks.where.mockResolvedValue([{ ...remoteRow(), agentUrl: null }]);

    const response = await GET(
      grepRequest({ workspaceId: "ws", pattern: "needle" }),
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      kind: "failed",
      message: 'Remote workspace "remote-ws" is missing agent or opencode URLs',
    });
  });

  describe("remote workspace", () => {
    beforeEach(() => {
      mocks.where.mockResolvedValue([remoteRow()]);
    });

    it("forwards the query to the agent and returns its ok outcome", async () => {
      const agentOutcome: ContentSearchOutcome = {
        kind: "ok",
        files: [],
        matchCount: 0,
        fileCount: 0,
        isLimitHit: false,
        isTimedOut: false,
        engine: "git-grep",
        durationMs: 4,
      };
      const fetchMock = vi.fn<typeof globalThis.fetch>(async () =>
        jsonResponse(agentOutcome, 200),
      );
      vi.stubGlobal("fetch", fetchMock);

      const request = grepRequest({
        workspaceId: "ws",
        pattern: "needle",
        caseSensitive: "1",
        include: "src/**",
      });

      const response = await GET(request);

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(agentOutcome);
      const requestedUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
      expect(`${requestedUrl.origin}${requestedUrl.pathname}`).toBe(
        `${AGENT_URL}/files/grep`,
      );
      expect(requestedUrl.searchParams.get("pattern")).toBe("needle");
      expect(requestedUrl.searchParams.get("caseSensitive")).toBe("1");
      expect(requestedUrl.searchParams.getAll("include")).toEqual(["src/**"]);
      expect(fetchMock.mock.calls[0]?.[1]?.signal).toBe(request.signal);
    });

    it.each<[ContentSearchOutcome, number]>([
      [{ kind: "invalid-pattern", message: "bad regex" }, 400],
      [{ kind: "unavailable", message: "no engine" }, 503],
      [{ kind: "failed", message: "boom" }, 500],
    ])(
      "returns the agent outcome %j with status %i",
      async (agentOutcome, expectedStatus) => {
        vi.stubGlobal(
          "fetch",
          vi.fn<typeof globalThis.fetch>(async () =>
            jsonResponse(agentOutcome, expectedStatus),
          ),
        );

        const response = await GET(
          grepRequest({ workspaceId: "ws", pattern: "needle" }),
        );

        expect(response.status).toBe(expectedStatus);
        expect(await response.json()).toEqual(agentOutcome);
      },
    );

    it("returns 503 unavailable when the agent has no /files/grep route", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn<typeof globalThis.fetch>(async () =>
          jsonResponse({ error: "Not Found" }, 404),
        ),
      );

      const response = await GET(
        grepRequest({ workspaceId: "ws", pattern: "needle" }),
      );

      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ kind: "unavailable" });
    });
  });
});

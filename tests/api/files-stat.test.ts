// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  where: vi.fn(),
}));
vi.mock("@/lib/auth/config", () => ({ auth: mocks.auth }));
vi.mock("@/lib/db", () => ({
  db: { select: () => ({ from: () => ({ where: mocks.where }) }) },
}));
vi.mock("@/drizzle/schema", () => ({
  workspaces: { id: "id", userId: "userId" },
}));
vi.mock("drizzle-orm", () => ({ eq: vi.fn(), and: vi.fn() }));
import { GET } from "@/app/api/files/stat/route";

let temporaryDirectory: string;
let workspaceRoot: string;
let outsideFile: string;

function statRequest(query: Record<string, string>) {
  const url = new URL("http://localhost/api/files/stat");
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value);
  }
  return new NextRequest(url);
}

beforeEach(() => {
  vi.clearAllMocks();
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "files-stat-"));
  workspaceRoot = path.join(temporaryDirectory, "workspace");
  fs.mkdirSync(path.join(workspaceRoot, "src"), { recursive: true });
  fs.writeFileSync(
    path.join(workspaceRoot, "src/a.ts"),
    "export const a = 1;\n",
  );
  outsideFile = path.join(temporaryDirectory, "secret.txt");
  fs.writeFileSync(outsideFile, "secret\n");
  fs.symlinkSync(outsideFile, path.join(workspaceRoot, "escape.ts"));
  mocks.auth.mockResolvedValue({ user: { id: "user" } });
  mocks.where.mockResolvedValue([
    { id: "ws", userId: "user", backend: "local", path: workspaceRoot },
  ]);
});

afterEach(() => {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

describe("GET /api/files/stat", () => {
  it("returns 401 when there is no session", async () => {
    mocks.auth.mockResolvedValue(null);
    const response = await GET(statRequest({ workspaceId: "ws", path: "" }));
    expect(response.status).toBe(401);
  });

  it("returns 404 when the workspace is unknown", async () => {
    mocks.where.mockResolvedValue([]);
    const response = await GET(statRequest({ workspaceId: "nope", path: "" }));
    expect(response.status).toBe(404);
  });

  it("returns 400 when the workspace has a remote backend", async () => {
    mocks.where.mockResolvedValue([
      { id: "ws", userId: "user", backend: "remote", path: workspaceRoot },
    ]);
    const response = await GET(statRequest({ workspaceId: "ws", path: "" }));
    expect(response.status).toBe(400);
  });

  it.each(["", "."])(
    "returns the workspace root as a directory when path is %j",
    async (rootPath) => {
      const response = await GET(
        statRequest({ workspaceId: "ws", path: rootPath }),
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ type: "directory" });
    },
  );

  it("returns file metadata for a workspace file", async () => {
    const stat = fs.statSync(path.join(workspaceRoot, "src/a.ts"));
    const response = await GET(
      statRequest({ workspaceId: "ws", path: "src/a.ts" }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      type: "file",
      size: stat.size,
      mtime: stat.mtimeMs,
      ctime: stat.ctimeMs,
    });
  });

  it("includes the file text when content=1 is requested", async () => {
    const response = await GET(
      statRequest({ workspaceId: "ws", path: "src/a.ts", content: "1" }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      type: "file",
      content: "export const a = 1;\n",
    });
  });

  it("returns 404 when the file is missing", async () => {
    const response = await GET(
      statRequest({ workspaceId: "ws", path: "src/missing.ts" }),
    );
    expect(response.status).toBe(404);
  });

  describe("rejects", () => {
    it("returns 400 for a path that traverses out of the workspace", async () => {
      const response = await GET(
        statRequest({ workspaceId: "ws", path: "../../etc/passwd" }),
      );
      expect(response.status).toBe(400);
    });

    it.each<Record<string, string>>([{}, { content: "1" }])(
      "returns 404 for a symlink escaping the workspace with %j",
      async (extraQuery) => {
        const response = await GET(
          statRequest({ workspaceId: "ws", path: "escape.ts", ...extraQuery }),
        );
        expect(response.status).toBe(404);
        expect(JSON.stringify(await response.json())).not.toContain("secret");
      },
    );
  });
});

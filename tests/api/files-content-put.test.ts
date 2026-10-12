// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  where: vi.fn(),
  writeFile: vi.fn(),
  guardedWrite: vi.fn(),
}));
vi.mock("@/lib/auth/config", () => ({ auth: mocks.auth }));
vi.mock("@/lib/db", () => ({
  db: { select: () => ({ from: () => ({ where: mocks.where }) }) },
}));
vi.mock("@/drizzle/schema", () => ({
  workspaces: { id: "id", userId: "userId" },
}));
vi.mock("drizzle-orm", () => ({ eq: vi.fn(), and: vi.fn() }));
vi.mock("@/lib/workspaces/backend", () => ({
  toWorkspace: (row: unknown) => row,
  getBackend: () => ({ writeFile: mocks.writeFile }),
}));
vi.mock("@/lib/files/operations", () => ({
  writeFileContentIfUnchanged: mocks.guardedWrite,
}));
import { PUT } from "@/app/api/files/content/route";

const request = (extra: Record<string, unknown> = {}) =>
  new NextRequest("http://localhost/api/files/content", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      workspaceId: "A",
      path: "a.ts",
      content: "typed",
      ...extra,
    }),
  });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: "user" } });
  mocks.where.mockResolvedValue([
    { id: "A", backend: "local", path: "/workspace" },
  ]);
  mocks.guardedWrite.mockReturnValue("written");
});
describe("files content PUT", () => {
  it("uses the existing write path without a base", async () => {
    expect((await PUT(request())).status).toBe(200);
    expect(mocks.writeFile).toHaveBeenCalledWith("a.ts", "typed");
    expect(mocks.guardedWrite).not.toHaveBeenCalled();
  });
  it("guards local writes with a matching base", async () => {
    expect((await PUT(request({ baseContent: "base" }))).status).toBe(200);
    expect(mocks.guardedWrite).toHaveBeenCalledWith(
      "/workspace",
      "a.ts",
      "typed",
      "base",
    );
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });
  it("returns STALE_BASE without writing when the base is stale", async () => {
    mocks.guardedWrite.mockReturnValue("stale");
    const response = await PUT(request({ baseContent: "base" }));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error:
        "This file changed on disk since you opened it (for example by a rename). Your text is kept — copy it, then reopen the file.",
      code: "STALE_BASE",
    });
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });
  it("keeps remote saves on the existing backend", async () => {
    mocks.where.mockResolvedValue([{ backend: "remote", path: "/remote" }]);
    expect((await PUT(request({ baseContent: "base" }))).status).toBe(200);
    expect(mocks.writeFile).toHaveBeenCalledWith("a.ts", "typed");
    expect(mocks.guardedWrite).not.toHaveBeenCalled();
  });
  it("rejects non-string baseContent", async () => {
    expect((await PUT(request({ baseContent: 3 }))).status).toBe(400);
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });
});

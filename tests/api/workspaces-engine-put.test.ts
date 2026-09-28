// @vitest-environment node
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/drizzle/schema";

const state = vi.hoisted(() => ({ db: undefined as unknown }));

const mockAuth = vi.fn();
vi.mock("@/lib/auth/config", () => ({ auth: mockAuth }));
vi.mock("@/lib/db", () => ({
  get db() {
    return state.db;
  },
}));

const USER = "user-1";
const OTHER_USER = "user-2";
const WORKSPACE_ID = "ws-1";
const OTHER_USER_WORKSPACE = "ws-other";

let sqlite: Database.Database;

function storedWorkspace(workspaceId: string): {
  name: string;
  engine: string | null;
} {
  return sqlite
    .prepare("SELECT name, engine FROM workspaces WHERE id = ?")
    .get(workspaceId) as { name: string; engine: string | null };
}

async function putWorkspace(
  workspaceId: string,
  body: unknown,
): Promise<Response> {
  const { PUT } = await import("@/app/api/workspaces/[id]/route");
  return PUT(
    new NextRequest(`http://localhost:3000/api/workspaces/${workspaceId}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: workspaceId }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  sqlite = new Database(":memory:");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: "drizzle/migrations" });
  state.db = db;

  const insertUser = sqlite.prepare(
    "INSERT INTO users (id, username, password_hash) VALUES (?, ?, 'hash')",
  );
  insertUser.run(USER, "user");
  insertUser.run(OTHER_USER, "other");
  const insertWorkspace = sqlite.prepare(
    "INSERT INTO workspaces (id, user_id, name, path, type, engine) VALUES (?, ?, ?, ?, 'repo', ?)",
  );
  insertWorkspace.run(WORKSPACE_ID, USER, "Workspace", "/tmp/ws-1", null);
  insertWorkspace.run(
    OTHER_USER_WORKSPACE,
    OTHER_USER,
    "Other",
    "/tmp/ws-other",
    null,
  );

  mockAuth.mockResolvedValue({ user: { id: USER } });
});

afterEach(() => {
  sqlite.close();
});

describe("PUT /api/workspaces/:id engine", () => {
  it("persists an omo override and returns the updated workspace", async () => {
    const response = await putWorkspace(WORKSPACE_ID, { engine: "omo" });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      id: WORKSPACE_ID,
      engine: "omo",
    });
    expect(storedWorkspace(WORKSPACE_ID).engine).toBe("omo");
  });

  it("persists opencode and clears the override with null", async () => {
    expect(
      (await putWorkspace(WORKSPACE_ID, { engine: "opencode" })).status,
    ).toBe(200);
    expect(storedWorkspace(WORKSPACE_ID).engine).toBe("opencode");

    expect((await putWorkspace(WORKSPACE_ID, { engine: null })).status).toBe(
      200,
    );
    expect(storedWorkspace(WORKSPACE_ID).engine).toBeNull();
  });

  it("rejects an unknown engine with 400 and leaves the row untouched", async () => {
    await putWorkspace(WORKSPACE_ID, { engine: "omo" });

    for (const engine of ["bogus", 7, "", { name: "omo" }]) {
      const response = await putWorkspace(WORKSPACE_ID, {
        name: "Renamed",
        engine,
      });
      expect(response.status).toBe(400);
    }

    expect(storedWorkspace(WORKSPACE_ID)).toEqual({
      name: "Workspace",
      engine: "omo",
    });
  });

  it("leaves the engine unchanged when the body omits it", async () => {
    await putWorkspace(WORKSPACE_ID, { engine: "omo" });

    const response = await putWorkspace(WORKSPACE_ID, { name: "Renamed" });

    expect(response.status).toBe(200);
    expect(storedWorkspace(WORKSPACE_ID)).toEqual({
      name: "Renamed",
      engine: "omo",
    });
  });

  it("does not change another user's workspace", async () => {
    const response = await putWorkspace(OTHER_USER_WORKSPACE, {
      engine: "omo",
    });

    expect(response.status).toBe(404);
    expect(storedWorkspace(OTHER_USER_WORKSPACE).engine).toBeNull();
  });
});

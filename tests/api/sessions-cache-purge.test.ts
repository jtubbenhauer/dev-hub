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

const mockGetOrStartServer = vi.fn(async () => ({
  url: "http://opencode.test",
}));
vi.mock("@/lib/opencode/server-pool", () => ({
  getOrStartServer: mockGetOrStartServer,
  stopServer: vi.fn(),
}));

const USER = "user-1";
const OTHER_USER = "user-2";
const WORKSPACE_A = "ws-a";
const WORKSPACE_B = "ws-b";
const OTHER_USER_WORKSPACE = "ws-other";
const CACHE_TABLES = [
  "cached_sessions",
  "cached_messages",
  "recovered_messages",
] as const;

let sqlite: Database.Database;

function seedCachedSession(
  userId: string,
  workspaceId: string,
  sessionId: string,
): void {
  sqlite
    .prepare(
      `INSERT INTO cached_sessions (id, workspace_id, user_id, title, created_at, updated_at, cached_at)
       VALUES (?, ?, ?, ?, 1, 2, 3)`,
    )
    .run(sessionId, workspaceId, userId, sessionId);
  sqlite
    .prepare(
      `INSERT INTO cached_messages (session_id, workspace_id, user_id, messages_json, cached_at)
       VALUES (?, ?, ?, '[]', 3)`,
    )
    .run(sessionId, workspaceId, userId);
  sqlite
    .prepare(
      `INSERT INTO recovered_messages (session_id, workspace_id, user_id, message_id, sequence, message_json, recovered_at)
       VALUES (?, ?, ?, ?, 1, '{}', 3)`,
    )
    .run(sessionId, workspaceId, userId, `${sessionId}-message`);
}

function sessionIdsIn(
  table: (typeof CACHE_TABLES)[number],
  userId: string,
  workspaceId: string,
): string[] {
  const idColumn = table === "cached_sessions" ? "id" : "session_id";
  const rows = sqlite
    .prepare(
      `SELECT ${idColumn} AS sessionId FROM ${table}
       WHERE user_id = ? AND workspace_id = ? ORDER BY ${idColumn}`,
    )
    .all(userId, workspaceId) as { sessionId: string }[];
  return rows.map((row) => row.sessionId);
}

function deleteRequest(query: string): NextRequest {
  return new NextRequest(`http://localhost:3000/api/sessions/cache?${query}`, {
    method: "DELETE",
  });
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
  insertWorkspace.run(WORKSPACE_A, USER, "A", "/tmp/ws-a", null);
  insertWorkspace.run(WORKSPACE_B, USER, "B", "/tmp/ws-b", "omo");
  insertWorkspace.run(
    OTHER_USER_WORKSPACE,
    OTHER_USER,
    "Other",
    "/tmp/ws-other",
    null,
  );

  for (const sessionId of ["s1", "s2"]) {
    seedCachedSession(USER, WORKSPACE_A, sessionId);
    seedCachedSession(USER, WORKSPACE_B, sessionId);
    seedCachedSession(OTHER_USER, WORKSPACE_A, sessionId);
    seedCachedSession(OTHER_USER, OTHER_USER_WORKSPACE, sessionId);
  }

  mockAuth.mockResolvedValue({ user: { id: USER } });
});

afterEach(() => {
  sqlite.close();
});

describe("DELETE /api/sessions/cache without sessionId", () => {
  it("removes every cached row for only that workspace across the three tables", async () => {
    const { DELETE } = await import("@/app/api/sessions/cache/route");

    const response = await DELETE(deleteRequest(`workspaceId=${WORKSPACE_A}`));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ deleted: true });
    for (const table of CACHE_TABLES) {
      expect(sessionIdsIn(table, USER, WORKSPACE_A)).toEqual([]);
      expect(sessionIdsIn(table, USER, WORKSPACE_B)).toEqual(["s1", "s2"]);
      expect(sessionIdsIn(table, OTHER_USER, WORKSPACE_A)).toEqual([
        "s1",
        "s2",
      ]);
    }
  });

  it("purges from the database without starting an OpenCode server", async () => {
    const { DELETE } = await import("@/app/api/sessions/cache/route");

    const response = await DELETE(deleteRequest(`workspaceId=${WORKSPACE_A}`));

    expect(response.status).toBe(200);
    expect(mockGetOrStartServer).not.toHaveBeenCalled();
  });

  it("returns 404 for a workspace the user does not own and deletes nothing", async () => {
    const { DELETE } = await import("@/app/api/sessions/cache/route");

    const response = await DELETE(
      deleteRequest(`workspaceId=${OTHER_USER_WORKSPACE}`),
    );

    expect(response.status).toBe(404);
    for (const table of CACHE_TABLES) {
      expect(sessionIdsIn(table, OTHER_USER, OTHER_USER_WORKSPACE)).toEqual([
        "s1",
        "s2",
      ]);
    }
  });

  it("rejects a missing workspaceId, an empty sessionId, and unauthenticated calls", async () => {
    const { DELETE } = await import("@/app/api/sessions/cache/route");

    expect((await DELETE(deleteRequest(""))).status).toBe(400);
    expect(
      (await DELETE(deleteRequest(`workspaceId=${WORKSPACE_A}&sessionId=`)))
        .status,
    ).toBe(400);
    mockAuth.mockResolvedValue(null);
    expect(
      (await DELETE(deleteRequest(`workspaceId=${WORKSPACE_A}`))).status,
    ).toBe(401);

    for (const table of CACHE_TABLES) {
      expect(sessionIdsIn(table, USER, WORKSPACE_A)).toEqual(["s1", "s2"]);
    }
  });
});

describe("DELETE /api/sessions/cache with sessionId", () => {
  it("still removes only that session's rows", async () => {
    const { DELETE } = await import("@/app/api/sessions/cache/route");

    const response = await DELETE(
      deleteRequest(`workspaceId=${WORKSPACE_A}&sessionId=s1`),
    );

    expect(response.status).toBe(200);
    for (const table of CACHE_TABLES) {
      expect(sessionIdsIn(table, USER, WORKSPACE_A)).toEqual(["s2"]);
      expect(sessionIdsIn(table, USER, WORKSPACE_B)).toEqual(["s1", "s2"]);
      expect(sessionIdsIn(table, OTHER_USER, WORKSPACE_A)).toEqual([
        "s1",
        "s2",
      ]);
    }
  });
});

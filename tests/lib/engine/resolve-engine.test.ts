// @vitest-environment node

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/drizzle/schema";

let sqlite: Database.Database;

describe("resolveWorkspaceEngine", () => {
  beforeEach(() => {
    vi.resetModules();
    sqlite = new Database(":memory:");
    sqlite.exec(`
      CREATE TABLE users (id TEXT PRIMARY KEY);
      CREATE TABLE workspaces (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        engine TEXT
      );
      CREATE TABLE settings (
        user_id TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT,
        PRIMARY KEY(user_id, key)
      );
      INSERT INTO users (id) VALUES ('user-1');
    `);
    vi.doMock("@/lib/db", () => ({ db: drizzle(sqlite, { schema }) }));
  });

  afterEach(() => {
    sqlite.close();
    vi.doUnmock("@/lib/db");
  });

  it("uses the workspace override before the global setting", async () => {
    sqlite.exec(`
      INSERT INTO workspaces (id, user_id, engine)
        VALUES ('workspace-1', 'user-1', 'omo');
      INSERT INTO settings (user_id, key, value)
        VALUES ('user-1', 'chat-engine', '"opencode"');
    `);
    const { resolveWorkspaceEngine } =
      await import("@/lib/engine/resolve-engine");

    await expect(resolveWorkspaceEngine("user-1", "workspace-1")).resolves.toBe(
      "omo",
    );
  });

  it("uses the global setting when the workspace has no override", async () => {
    sqlite.exec(`
      INSERT INTO workspaces (id, user_id, engine)
        VALUES ('workspace-1', 'user-1', NULL);
      INSERT INTO settings (user_id, key, value)
        VALUES ('user-1', 'chat-engine', '"omo"');
    `);
    const { resolveWorkspaceEngine } =
      await import("@/lib/engine/resolve-engine");

    await expect(resolveWorkspaceEngine("user-1", "workspace-1")).resolves.toBe(
      "omo",
    );
  });

  it("uses opencode when no override or global setting exists", async () => {
    sqlite.exec(`
      INSERT INTO workspaces (id, user_id, engine)
        VALUES ('workspace-1', 'user-1', NULL);
    `);
    const { resolveWorkspaceEngine } =
      await import("@/lib/engine/resolve-engine");

    await expect(resolveWorkspaceEngine("user-1", "workspace-1")).resolves.toBe(
      "opencode",
    );
  });

  it("falls back to opencode for an invalid selected value", async () => {
    sqlite.exec(`
      INSERT INTO workspaces (id, user_id, engine)
        VALUES ('workspace-1', 'user-1', 'invalid');
      INSERT INTO settings (user_id, key, value)
        VALUES ('user-1', 'chat-engine', '"omo"');
    `);
    const { resolveWorkspaceEngine } =
      await import("@/lib/engine/resolve-engine");

    await expect(resolveWorkspaceEngine("user-1", "workspace-1")).resolves.toBe(
      "opencode",
    );
  });
});

import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("cached message tenant migration", () => {
  it("allows the same workspace and session IDs for different users", () => {
    const dbPath = join(tmpdir(), `message-cache-${crypto.randomUUID()}.db`);
    const sqlite = new Database(dbPath);
    try {
      sqlite.exec(`
        CREATE TABLE cached_messages (
          session_id text NOT NULL,
          workspace_id text NOT NULL,
          user_id text NOT NULL,
          messages_json text NOT NULL,
          cached_at integer NOT NULL,
          PRIMARY KEY(session_id, workspace_id)
        );
        INSERT INTO cached_messages VALUES
          ('session-1', 'workspace-1', 'user-1', '[]', 1);
        CREATE TABLE cached_sessions (
          id text PRIMARY KEY NOT NULL,
          workspace_id text NOT NULL,
          user_id text NOT NULL,
          title text,
          parent_id text,
          status text,
          created_at integer,
          updated_at integer,
          cached_at integer NOT NULL
        );
      `);
      const migration = readFileSync(
        join(process.cwd(), "drizzle/migrations/0015_plain_iron_fist.sql"),
        "utf8",
      ).replaceAll("--> statement-breakpoint", "");
      sqlite.exec(migration);

      const migrated = sqlite
        .prepare(
          "SELECT authoritative_message_ids_json FROM cached_messages WHERE user_id = ?",
        )
        .get("user-1");
      expect(migrated).toEqual({ authoritative_message_ids_json: "[]" });

      sqlite
        .prepare(
          "INSERT INTO cached_messages (session_id, workspace_id, user_id, messages_json, cached_at) VALUES (?, ?, ?, ?, ?)",
        )
        .run("session-1", "workspace-1", "user-2", "[]", 2);

      const rows = sqlite
        .prepare(
          "SELECT user_id FROM cached_messages WHERE workspace_id = ? AND session_id = ? ORDER BY user_id",
        )
        .all("workspace-1", "session-1");
      expect(rows).toEqual([{ user_id: "user-1" }, { user_id: "user-2" }]);
    } finally {
      sqlite.close();
      rmSync(dbPath, { force: true });
    }
  });
});

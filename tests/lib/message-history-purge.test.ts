import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/drizzle/schema";
import type { MessageWithParts } from "@/lib/opencode/types";

let sqlite: Database.Database;

function message(id: string, created: number): MessageWithParts {
  return {
    info: {
      id,
      sessionID: "session-1",
      role: "user",
      time: { created },
      agent: "build",
      model: { providerID: "provider", modelID: "model" },
    },
    parts: [
      {
        id: `part-${id}`,
        sessionID: "session-1",
        messageID: id,
        type: "text",
        text: id,
      },
    ],
  };
}

describe("message history purge", () => {
  beforeEach(() => {
    vi.resetModules();
    sqlite = new Database(":memory:");
    sqlite.exec(`
      CREATE TABLE cached_messages (
        session_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        messages_json TEXT NOT NULL,
        authoritative_message_ids_json TEXT NOT NULL,
        cached_at INTEGER NOT NULL,
        PRIMARY KEY(user_id, workspace_id, session_id)
      );
      CREATE TABLE recovered_messages (
        session_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        message_json TEXT NOT NULL,
        recovered_at INTEGER NOT NULL,
        PRIMARY KEY(user_id, workspace_id, session_id, message_id)
      );
    `);
    vi.doMock("@/lib/db", () => ({ db: drizzle(sqlite, { schema }) }));
  });

  afterEach(() => {
    sqlite.close();
    vi.doUnmock("@/lib/db");
  });

  it("purges recovered-only messages after a cached anchor", async () => {
    const cached = [message("a", 10), message("c", 20)];
    sqlite
      .prepare("INSERT INTO cached_messages VALUES (?, ?, ?, ?, ?, ?)")
      .run(
        "session-1",
        "workspace-1",
        "user-1",
        JSON.stringify(cached),
        JSON.stringify(["a", "c"]),
        1,
      );
    const insertRecovered = sqlite.prepare(
      "INSERT INTO recovered_messages VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    for (const archived of [...cached, message("d", 30)]) {
      insertRecovered.run(
        "session-1",
        "workspace-1",
        "user-1",
        archived.info.id,
        archived.info.time.created,
        JSON.stringify(archived),
        1,
      );
    }
    const { purgeMessageHistory } =
      await import("@/lib/opencode/message-history-purge");

    const purged = purgeMessageHistory({
      userId: "user-1",
      workspaceId: "workspace-1",
      sessionId: "session-1",
      fromMessageId: "c",
    });

    expect(purged).toBe(2);
    const recovered = sqlite
      .prepare("SELECT message_id FROM recovered_messages ORDER BY message_id")
      .all();
    expect(recovered).toEqual([{ message_id: "a" }]);
  });
});

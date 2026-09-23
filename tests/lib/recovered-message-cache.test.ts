import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/drizzle/schema";
import type { MessageWithParts } from "@/lib/opencode/types";

let sqlite: Database.Database;

function message(id: string, text: string): MessageWithParts {
  return {
    info: {
      id,
      sessionID: "session-1",
      role: "user",
      time: { created: 1_000 },
      agent: "",
      model: { providerID: "", modelID: "" },
    },
    parts: [
      {
        id: `part-${id}`,
        sessionID: "session-1",
        messageID: id,
        type: "text",
        text,
      },
    ],
  };
}

describe("recovered message archive", () => {
  beforeEach(() => {
    vi.resetModules();
    sqlite = new Database(":memory:");
    sqlite.exec(`
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
      CREATE INDEX recovered_messages_lookup_idx
        ON recovered_messages(user_id, workspace_id, session_id, sequence);
    `);
    const database = drizzle(sqlite, { schema });
    vi.doMock("@/lib/db", () => ({ db: database }));
  });

  afterEach(() => {
    sqlite.close();
    vi.doUnmock("@/lib/db");
  });

  it("writes authoritative messages idempotently and keeps tenants isolated", async () => {
    const { readRecoveredMessages, writeRecoveredMessages } =
      await import("@/lib/opencode/recovered-message-cache");

    await writeRecoveredMessages({
      userId: "user-1",
      workspaceId: "workspace-1",
      sessionId: "session-1",
      messages: [message("message-1", "first")],
    });
    await writeRecoveredMessages({
      userId: "user-1",
      workspaceId: "workspace-1",
      sessionId: "session-1",
      messages: [message("message-1", "updated content")],
    });
    await writeRecoveredMessages({
      userId: "user-2",
      workspaceId: "workspace-1",
      sessionId: "session-1",
      messages: [message("message-1", "other tenant")],
    });
    await writeRecoveredMessages({
      userId: "user-1",
      workspaceId: "workspace-1",
      sessionId: "session-1",
      messages: [message("message-1", "x")],
    });

    const userOne = await readRecoveredMessages(
      "user-1",
      "workspace-1",
      "session-1",
    );
    const userTwo = await readRecoveredMessages(
      "user-2",
      "workspace-1",
      "session-1",
    );

    expect(userOne).toHaveLength(1);
    expect(userOne[0].message.parts[0]).toMatchObject({
      type: "text",
      text: "x",
    });
    expect(userTwo).toHaveLength(1);
    expect(userTwo[0].message.parts[0]).toMatchObject({
      type: "text",
      text: "other tenant",
    });
  });

  it("skips malformed rows and rows whose identity disagrees with the payload", async () => {
    const { readRecoveredMessages } =
      await import("@/lib/opencode/recovered-message-cache");
    const insert = sqlite.prepare(`
      INSERT INTO recovered_messages
        (session_id, workspace_id, user_id, message_id, sequence, message_json, recovered_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    insert.run(
      "session-1",
      "workspace-1",
      "user-1",
      "invalid-json",
      1,
      "{invalid",
      1,
    );
    insert.run(
      "session-1",
      "workspace-1",
      "user-1",
      "different-id",
      2,
      JSON.stringify(message("message-1", "wrong identity")),
      1,
    );

    const result = await readRecoveredMessages(
      "user-1",
      "workspace-1",
      "session-1",
    );

    expect(result).toEqual([]);
  });

  it("does not rewrite an archived row when the payload is unchanged", async () => {
    const { writeRecoveredMessages } =
      await import("@/lib/opencode/recovered-message-cache");
    const readRecoveredAt = (): unknown =>
      sqlite
        .prepare("SELECT recovered_at FROM recovered_messages")
        .pluck()
        .get();
    const archive = () =>
      writeRecoveredMessages({
        userId: "user-1",
        workspaceId: "workspace-1",
        sessionId: "session-1",
        messages: [message("message-1", "stable")],
      });

    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_000);
    await archive();
    const firstRecoveredAt = readRecoveredAt();

    nowSpy.mockReturnValue(2_000);
    await archive();
    const secondRecoveredAt = readRecoveredAt();
    nowSpy.mockRestore();

    expect(firstRecoveredAt).toBe(1_000);
    expect(secondRecoveredAt).toBe(1_000);
  });
});

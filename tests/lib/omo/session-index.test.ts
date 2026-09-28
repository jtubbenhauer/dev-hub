// @vitest-environment node

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/drizzle/schema";

let sqlite: Database.Database;

const touchRow = {
  durableId: "root",
  sessionPath: "/sessions/root.jsonl",
  title: "Root",
  createdMs: 100,
  updatedMs: 200,
};

function insertWorkspace(id: string): void {
  sqlite
    .prepare("INSERT INTO workspaces (id, user_id) VALUES (?, 'user-1')")
    .run(id);
}

function readRow(workspaceId: string, durableId: string) {
  return sqlite
    .prepare(
      "SELECT * FROM omo_session_index WHERE workspace_id = ? AND durable_id = ?",
    )
    .get(workspaceId, durableId);
}

describe("OMO session index", () => {
  beforeEach(() => {
    vi.resetModules();
    sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = ON");
    sqlite.exec(`
      CREATE TABLE users (id TEXT PRIMARY KEY);
      CREATE TABLE workspaces (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL
      );
      CREATE TABLE omo_session_index (
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        durable_id TEXT NOT NULL,
        session_path TEXT,
        parent_durable_id TEXT,
        kind TEXT NOT NULL,
        agent TEXT,
        category TEXT,
        context TEXT,
        context_authoritative INTEGER NOT NULL DEFAULT 0,
        replaced_by_durable_id TEXT,
        title TEXT NOT NULL,
        created_ms INTEGER NOT NULL,
        updated_ms INTEGER NOT NULL,
        leaf_known INTEGER NOT NULL DEFAULT 0,
        leaf_entry_id TEXT,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY(workspace_id, durable_id)
      );
      CREATE UNIQUE INDEX omo_session_index_path_uq
        ON omo_session_index(workspace_id, session_path);
      CREATE TABLE pinned_sessions (
        workspace_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        pinned_at INTEGER NOT NULL,
        PRIMARY KEY(workspace_id, session_id)
      );
      CREATE TABLE session_notes (
        workspace_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        note TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY(workspace_id, session_id)
      );
      CREATE TABLE cached_sessions (
        id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        cached_at INTEGER NOT NULL,
        PRIMARY KEY(user_id, workspace_id, id)
      );
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
      INSERT INTO users (id) VALUES ('user-1');
    `);
    insertWorkspace("workspace-1");
    vi.doMock("@/lib/db", () => ({ db: drizzle(sqlite, { schema }) }));
  });

  afterEach(() => {
    sqlite.close();
    vi.doUnmock("@/lib/db");
  });

  it("upserts authoritative children while preserving discovered parent metadata", async () => {
    const index = await import("@/lib/omo/session-index");
    await index.mergeOmoSessionIndexFromTaskEvent("workspace-1", [
      {
        durableId: "child",
        parentDurableId: "parent",
        agent: "explore",
        title: "task",
        createdMs: 10,
        updatedMs: 10,
      },
    ]);

    await index.upsertOmoSessionIndexAuthoritative("workspace-1", [
      {
        durableId: "child",
        sessionPath: "/sessions/child.jsonl",
        kind: "worker",
        context: { owner: "task" },
        title: "Child",
        createdMs: 10,
        updatedMs: 20,
      },
    ]);

    const children = await index.getOmoChildren("workspace-1", "parent");
    expect(children).toHaveLength(1);
    expect(children[0]).toMatchObject({
      durableId: "child",
      parentDurableId: "parent",
      contextAuthoritative: 1,
    });
  });

  it("keeps worker kind and context bytes during non-authoritative merges", async () => {
    const index = await import("@/lib/omo/session-index");
    sqlite
      .prepare(
        `INSERT INTO omo_session_index
          (workspace_id, durable_id, session_path, kind, context,
           context_authoritative, title, created_ms, updated_ms, updated_at)
         VALUES (?, ?, ?, 'worker', ?, 0, 'Worker', 10, 20, 1)`,
      )
      .run(
        "workspace-1",
        "worker",
        "/sessions/worker.jsonl",
        '{"stable":"bytes"}',
      );
    await index.mergeOmoSessionIndexFromTaskEvent("workspace-1", [
      {
        durableId: "worker",
        agent: "librarian",
        title: "Worker",
        createdMs: 10,
        updatedMs: 20,
      },
    ]);

    expect(readRow("workspace-1", "worker")).toMatchObject({
      kind: "worker",
      context: '{"stable":"bytes"}',
      context_authoritative: 0,
    });
  });

  it("rejects path identity conflicts without changing the provisional row", async () => {
    const index = await import("@/lib/omo/session-index");
    await index.touchOmoSessionIndex(
      "workspace-1",
      "a",
      "/sessions/shared.jsonl",
      { ...touchRow, title: "A" },
    );
    await index.mergeOmoSessionIndexFromTaskEvent("workspace-1", [
      { durableId: "b", title: "B", createdMs: 100, updatedMs: 100 },
    ]);

    await expect(
      index.touchOmoSessionIndex("workspace-1", "b", "/sessions/shared.jsonl", {
        ...touchRow,
        title: "B",
      }),
    ).rejects.toBeInstanceOf(index.OmoSessionIdentityConflictError);
    expect(readRow("workspace-1", "b")).toMatchObject({ session_path: null });
  });

  it("validates context shape, names, counts, and UTF-8 byte caps", async () => {
    const { parseOmoSessionContext } = await import("@/lib/omo/session-index");
    expect(parseOmoSessionContext({ a: 1 })).toBeNull();
    expect(parseOmoSessionContext([])).toBeNull();
    expect(
      parseOmoSessionContext(
        Object.fromEntries(
          Array.from({ length: 33 }, (_, i) => [`k${i}`, "v"]),
        ),
      ),
    ).toBeNull();
    expect(parseOmoSessionContext({ "Bad-Key": "v" })).toBeNull();
    expect(parseOmoSessionContext({ value: "a".repeat(17 * 1024) })).toBeNull();
    expect(parseOmoSessionContext({ value: "a".repeat(16 * 1024) })).toEqual({
      value: "a".repeat(16 * 1024),
    });
    expect(parseOmoSessionContext({ value: "界".repeat(6_000) })).toBeNull();
    expect(
      parseOmoSessionContext({ a: "界".repeat(5_500), b: "界".repeat(5_500) }),
    ).toBeNull();
    expect(
      parseOmoSessionContext({ a: "a".repeat(5_500), b: "a".repeat(5_500) }),
    ).not.toBeNull();
  });

  it("returns null instead of throwing for corrupt stored context", async () => {
    const { readStoredContext } = await import("@/lib/omo/session-index");
    expect(readStoredContext({ context: "{not json" })).toBeNull();
  });

  it("isolates identical durable ids by workspace", async () => {
    insertWorkspace("workspace-2");
    const { touchOmoSessionIndex, getOmoIndexRow } =
      await import("@/lib/omo/session-index");
    await touchOmoSessionIndex(
      "workspace-1",
      "same",
      "/sessions/one.jsonl",
      touchRow,
    );
    await touchOmoSessionIndex(
      "workspace-2",
      "same",
      "/sessions/two.jsonl",
      touchRow,
    );

    expect(await getOmoIndexRow("workspace-1", "same")).toMatchObject({
      sessionPath: "/sessions/one.jsonl",
    });
    expect(await getOmoIndexRow("workspace-2", "same")).toMatchObject({
      sessionPath: "/sessions/two.jsonl",
    });
  });

  it("lists hidden workers, descendants, and replaced rows", async () => {
    const index = await import("@/lib/omo/session-index");
    await index.mergeOmoSessionIndexFromTaskEvent("workspace-1", [
      { durableId: "worker", title: "Worker", createdMs: 1, updatedMs: 1 },
      {
        durableId: "child",
        parentDurableId: "root",
        title: "Child",
        createdMs: 1,
        updatedMs: 1,
      },
    ]);

    await expect(index.listOmoHiddenIds("workspace-1")).resolves.toEqual(
      expect.arrayContaining(["worker", "child"]),
    );
  });

  it("round-trips leaves and removes every descendant", async () => {
    const index = await import("@/lib/omo/session-index");
    await index.mergeOmoSessionIndexFromTaskEvent("workspace-1", [
      { durableId: "parent", title: "P", createdMs: 1, updatedMs: 1 },
      {
        durableId: "child",
        parentDurableId: "parent",
        title: "C",
        createdMs: 1,
        updatedMs: 1,
      },
      {
        durableId: "grandchild",
        parentDurableId: "child",
        title: "G",
        createdMs: 1,
        updatedMs: 1,
      },
    ]);
    await index.setOmoLeaf("workspace-1", "parent", "entry-1");
    expect(await index.getOmoIndexRow("workspace-1", "parent")).toMatchObject({
      leafKnown: 1,
      leafEntryId: "entry-1",
    });

    await index.deleteOmoIndexRowWithDescendants("workspace-1", "parent");
    expect(
      sqlite.prepare("SELECT durable_id FROM omo_session_index").all(),
    ).toEqual([]);
  });

  it("performs change-only touches with monotonic activity", async () => {
    const index = await import("@/lib/omo/session-index");
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
    expect(
      await index.touchOmoSessionIndexMany("workspace-1", [touchRow]),
    ).toBe(1);
    const first = readRow("workspace-1", "root");
    now.mockReturnValue(2_000);
    expect(
      await index.touchOmoSessionIndexMany("workspace-1", [touchRow]),
    ).toBe(0);
    expect(readRow("workspace-1", "root")).toEqual(first);
    await index.touchOmoSessionIndex(
      "workspace-1",
      "root",
      touchRow.sessionPath,
      { ...touchRow, updatedMs: 100 },
    );
    await index.setOmoLeafAndActivity("workspace-1", "root", null, 150);
    expect(await index.getOmoIndexRow("workspace-1", "root")).toMatchObject({
      updatedMs: 200,
    });
    now.mockRestore();
  });

  it("creates complete task-event-only worker rows", async () => {
    const { mergeOmoSessionIndexFromTaskEvent, getOmoIndexRow } =
      await import("@/lib/omo/session-index");
    await mergeOmoSessionIndexFromTaskEvent("workspace-1", [
      { durableId: "worker", agent: "explore" },
    ]);

    expect(await getOmoIndexRow("workspace-1", "worker")).toMatchObject({
      kind: "worker",
      title: "explore",
    });
    expect(readRow("workspace-1", "worker")).toMatchObject({
      created_ms: expect.any(Number),
      updated_ms: expect.any(Number),
    });
  });

  it("records replacement metadata and moves associated persistence", async () => {
    const index = await import("@/lib/omo/session-index");
    await index.mergeOmoSessionIndexFromTaskEvent("workspace-1", [
      {
        durableId: "old",
        parentDurableId: "parent",
        title: "Old title",
        createdMs: 10,
        updatedMs: 20,
      },
    ]);
    await index.upsertOmoSessionIndexAuthoritative("workspace-1", [
      {
        durableId: "old",
        sessionPath: "/sessions/old.jsonl",
        kind: "worker",
        context: { owner: "old" },
        title: "Old title",
        createdMs: 10,
        updatedMs: 20,
      },
    ]);
    sqlite.exec(`
      INSERT INTO pinned_sessions VALUES ('workspace-1', 'omo_old', 1);
      INSERT INTO session_notes VALUES ('workspace-1', 'omo_old', 'note', 1);
      INSERT INTO cached_sessions VALUES ('omo_old', 'workspace-1', 'user-1', 1);
      INSERT INTO cached_messages VALUES ('omo_old', 'workspace-1', 'user-1', '[]', '[]', 1);
      INSERT INTO recovered_messages VALUES ('omo_old', 'workspace-1', 'user-1', 'm', 1, '{}', 1);
    `);

    await index.recordOmoSessionReplacement(
      "workspace-1",
      "old",
      "new",
      "/sessions/new.jsonl",
    );

    expect(await index.getOmoIndexRow("workspace-1", "new")).toMatchObject({
      parentDurableId: "parent",
      title: "Old title",
      context: '{"owner":"old"}',
    });
    expect(await index.listOmoHiddenIds("workspace-1")).toContain("old");
    expect(
      sqlite.prepare("SELECT session_id FROM pinned_sessions").pluck().all(),
    ).toEqual(["omo_new"]);
    expect(
      sqlite.prepare("SELECT session_id FROM session_notes").pluck().all(),
    ).toEqual(["omo_new"]);
    expect(
      sqlite.prepare("SELECT id FROM cached_sessions").pluck().all(),
    ).toEqual([]);
    expect(
      sqlite.prepare("SELECT session_id FROM cached_messages").pluck().all(),
    ).toEqual([]);
    expect(
      sqlite.prepare("SELECT session_id FROM recovered_messages").pluck().all(),
    ).toEqual([]);
  });
});

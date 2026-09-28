import Database from "better-sqlite3";

type IndexRowFixture = {
  readonly sqlite: Database.Database;
  readonly workspace: { readonly id: string };
};

export function createRegistryTestDatabase(): Database.Database {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(`
    CREATE TABLE workspaces (id TEXT PRIMARY KEY, user_id TEXT NOT NULL);
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
    INSERT INTO workspaces VALUES ('workspace-1', 'user-1');
  `);
  return sqlite;
}

export function insertIndexRow(
  sqlite: Database.Database,
  values: {
    readonly workspaceId?: string;
    readonly durableId: string;
    readonly sessionPath: string | null;
    readonly kind?: "interactive" | "worker";
    readonly context?: string | null;
    readonly contextAuthoritative?: number;
    readonly leafKnown?: number;
    readonly leafEntryId?: string | null;
    readonly replacedByDurableId?: string | null;
  },
): void {
  sqlite
    .prepare(
      `INSERT INTO omo_session_index
        (workspace_id, durable_id, session_path, kind, context,
         context_authoritative, replaced_by_durable_id, title, created_ms,
         updated_ms, leaf_known, leaf_entry_id, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 10, 20, ?, ?, 1)`,
    )
    .run(
      values.workspaceId ?? "workspace-1",
      values.durableId,
      values.sessionPath,
      values.kind ?? "interactive",
      values.context ?? null,
      values.contextAuthoritative ?? 0,
      values.replacedByDurableId ?? null,
      values.durableId,
      values.leafKnown ?? 0,
      values.leafEntryId ?? null,
    );
}

export function readIndexRow(
  fixture: IndexRowFixture,
  durableId: string,
): Record<string, unknown> | undefined {
  const value: unknown = fixture.sqlite
    .prepare(
      "SELECT * FROM omo_session_index WHERE workspace_id = ? AND durable_id = ?",
    )
    .get(fixture.workspace.id, durableId);
  return typeof value === "object" && value !== null
    ? Object.fromEntries(Object.entries(value))
    : undefined;
}

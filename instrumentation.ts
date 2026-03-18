export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
    const { readMigrationFiles } = await import("drizzle-orm/migrator");
    const path = await import("node:path");
    const { db } = await import("@/lib/db");

    const migrationsFolder = path.join(process.cwd(), "drizzle/migrations");
    seedJournalForPushCreatedDb(db, migrationsFolder, readMigrationFiles);
    migrate(db, { migrationsFolder });

    const { startPtyServer } = await import("@/lib/terminal/pty-server");
    startPtyServer();
  }
}

// DBs created via `db:push` have all tables but no __drizzle_migrations journal.
// When no journal exists, seed it with every known migration hash so `migrate()`
// doesn't re-run already-applied DDL. Once a journal exists, we leave it alone
// and let `migrate()` apply any new migrations normally.
function seedJournalForPushCreatedDb(
  db: import("drizzle-orm/better-sqlite3").BetterSQLite3Database<
    Record<string, unknown>
  >,
  migrationsFolder: string,
  readMigrationFiles: typeof import("drizzle-orm/migrator").readMigrationFiles,
) {
  const client = (
    db as unknown as { $client: import("better-sqlite3").Database }
  ).$client;

  const hasWorkspaces = client
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='workspaces'",
    )
    .get();
  if (!hasWorkspaces) return;

  const hasJournal = client
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='__drizzle_migrations'",
    )
    .get();

  if (hasJournal) return;

  // Fresh db:push — no journal exists but tables do. Create the journal and
  // seed every known migration so migrate() won't re-run DDL that db:push
  // already applied. If the journal already exists, we leave it alone and let
  // migrate() apply any new migrations normally.
  client.exec(`CREATE TABLE "__drizzle_migrations" (
    id SERIAL PRIMARY KEY,
    hash text NOT NULL,
    created_at numeric
  )`);

  const migrations = readMigrationFiles({ migrationsFolder });
  const insert = client.prepare(
    "INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)",
  );
  for (const m of migrations) {
    insert.run(m.hash, m.folderMillis);
  }
}

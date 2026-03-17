export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { migrate } = await import("drizzle-orm/better-sqlite3/migrator")
    const { readMigrationFiles } = await import("drizzle-orm/migrator")
    const path = await import("node:path")
    const { db } = await import("@/lib/db")

    const migrationsFolder = path.join(process.cwd(), "drizzle/migrations")
    seedJournalForPushCreatedDb(db, migrationsFolder, readMigrationFiles)
    migrate(db, { migrationsFolder })
  }
}

// DBs created via `db:push` have all tables but an empty __drizzle_migrations
// journal. Seed the journal so `migrate()` doesn't re-run already-applied DDL.
// Also handles the mixed case: some migrations tracked, but newer tables added
// via `db:push` whose migrations aren't yet in the journal.
function seedJournalForPushCreatedDb(
  db: import("drizzle-orm/better-sqlite3").BetterSQLite3Database<Record<string, unknown>>,
  migrationsFolder: string,
  readMigrationFiles: typeof import("drizzle-orm/migrator").readMigrationFiles,
) {
  const client = (db as unknown as { $client: import("better-sqlite3").Database }).$client

  const hasWorkspaces = client
    .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='workspaces'")
    .get()
  if (!hasWorkspaces) return

  const hasJournal = client
    .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='__drizzle_migrations'")
    .get()

  if (!hasJournal) {
    client.exec(`CREATE TABLE "__drizzle_migrations" (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at numeric
    )`)
  }

  const migrations = readMigrationFiles({ migrationsFolder })
  const existingHashes = new Set(
    (client.prepare("SELECT hash FROM __drizzle_migrations").all() as { hash: string }[])
      .map(r => r.hash),
  )

  const insert = client.prepare("INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)")
  for (const m of migrations) {
    if (!existingHashes.has(m.hash)) {
      insert.run(m.hash, m.folderMillis)
    }
  }
}

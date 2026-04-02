import Database, { type Database as DatabaseType } from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import path from "node:path";

const DB_PATH =
  process.env.DEVHUB_DB_PATH ||
  path.join(process.env.DEVHUB_PROJECT_DIR || process.cwd(), "dev-hub.db");

const sqlite = new Database(DB_PATH, { readonly: true });
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");
sqlite.pragma("busy_timeout = 5000");

export const sqliteDb: DatabaseType = sqlite;
export const db = drizzle(sqlite);
export type Db = typeof db;

import { sqliteTable, text, integer, primaryKey } from "drizzle-orm/sqlite-core"
import { sql } from "drizzle-orm"

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
})

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
})

export const workspaces = sqliteTable("workspaces", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  name: text("name").notNull(),
  path: text("path").notNull(),
  type: text("type", { enum: ["repo", "worktree"] }).notNull(),
  parentRepoPath: text("parent_repo_path"),
  packageManager: text("package_manager", {
    enum: ["pnpm", "npm", "bun", "cargo", "go", "none"],
  }),
  quickCommands: text("quick_commands", { mode: "json" }),
  backend: text("backend", { enum: ["local", "remote"] }).notNull().default("local"),
  provider: text("provider"),
  opencodeUrl: text("opencode_url"),
  agentUrl: text("agent_url"),
  providerMeta: text("provider_meta", { mode: "json" }),
  worktreeSymlinks: text("worktree_symlinks", { mode: "json" }).$type<string[]>(),
  linkedTaskId: text("linked_task_id"),
  linkedTaskMeta: text("linked_task_meta", { mode: "json" }),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  lastAccessedAt: integer("last_accessed_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
})

export const commandHistory = sqliteTable("command_history", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  command: text("command").notNull(),
  exitCode: integer("exit_code"),
  executedAt: integer("executed_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
})

export const settings = sqliteTable("settings", {
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  key: text("key").notNull(),
  value: text("value", { mode: "json" }),
}, (table) => [
  primaryKey({ columns: [table.userId, table.key] }),
])

export const auditLog = sqliteTable("audit_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  action: text("action").notNull(),
  detail: text("detail", { mode: "json" }),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
})

export const reviews = sqliteTable("reviews", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  mode: text("mode", { enum: ["branch", "uncommitted", "last-commit"] }).notNull(),
  targetRef: text("target_ref"),
  baseRef: text("base_ref"),
  mergeBase: text("merge_base"),
  totalFiles: integer("total_files").notNull().default(0),
  reviewedFiles: integer("reviewed_files").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
})

export const reviewFiles = sqliteTable("review_files", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  reviewId: text("review_id")
    .notNull()
    .references(() => reviews.id, { onDelete: "cascade" }),
  path: text("path").notNull(),
  status: text("status", {
    enum: ["added", "modified", "deleted", "renamed", "copied", "type-changed", "untracked"],
  }).notNull(),
  oldPath: text("old_path"),
  reviewed: integer("reviewed", { mode: "boolean" }).notNull().default(false),
  diffHash: text("diff_hash"),
  reviewedAt: integer("reviewed_at", { mode: "timestamp" }),
})

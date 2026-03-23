import {
  sqliteTable,
  text,
  integer,
  primaryKey,
  index,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [index("sessions_user_id_idx").on(table.userId)],
);

export const workspaces = sqliteTable(
  "workspaces",
  {
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
    backend: text("backend", { enum: ["local", "remote"] })
      .notNull()
      .default("local"),
    provider: text("provider"),
    opencodeUrl: text("opencode_url"),
    agentUrl: text("agent_url"),
    providerMeta: text("provider_meta", { mode: "json" }),
    shellCommand: text("shell_command"),
    worktreeSymlinks: text("worktree_symlinks", { mode: "json" }).$type<
      string[]
    >(),
    linkedTaskId: text("linked_task_id"),
    linkedTaskMeta: text("linked_task_meta", { mode: "json" }),
    color: text("color"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    lastAccessedAt: integer("last_accessed_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [index("workspaces_user_id_idx").on(table.userId)],
);

export const commandHistory = sqliteTable(
  "command_history",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    command: text("command").notNull(),
    exitCode: integer("exit_code"),
    executedAt: integer("executed_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [
    index("command_history_workspace_id_executed_at_idx").on(
      table.workspaceId,
      table.executedAt,
    ),
  ],
);

export const settings = sqliteTable(
  "settings",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    key: text("key").notNull(),
    value: text("value", { mode: "json" }),
  },
  (table) => [primaryKey({ columns: [table.userId, table.key] })],
);

export const auditLog = sqliteTable(
  "audit_log",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    action: text("action").notNull(),
    detail: text("detail", { mode: "json" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [
    index("audit_log_user_id_created_at_idx").on(table.userId, table.createdAt),
  ],
);

export const reviews = sqliteTable(
  "reviews",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    mode: text("mode", {
      enum: ["branch", "uncommitted", "last-commit"],
    }).notNull(),
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
  },
  (table) => [index("reviews_workspace_id_idx").on(table.workspaceId)],
);

export const reviewFiles = sqliteTable(
  "review_files",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    reviewId: text("review_id")
      .notNull()
      .references(() => reviews.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    status: text("status", {
      enum: [
        "added",
        "modified",
        "deleted",
        "renamed",
        "copied",
        "type-changed",
        "untracked",
      ],
    }).notNull(),
    oldPath: text("old_path"),
    reviewed: integer("reviewed", { mode: "boolean" }).notNull().default(false),
    diffHash: text("diff_hash"),
    reviewedAt: integer("reviewed_at", { mode: "timestamp" }),
  },
  (table) => [index("review_files_review_id_idx").on(table.reviewId)],
);

export const pinnedSessions = sqliteTable(
  "pinned_sessions",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    sessionId: text("session_id").notNull(),
    pinnedAt: integer("pinned_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [primaryKey({ columns: [table.workspaceId, table.sessionId] })],
);

export const fileComments = sqliteTable(
  "file_comments",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    filePath: text("file_path").notNull(),
    startLine: integer("start_line").notNull(),
    endLine: integer("end_line").notNull(),
    body: text("body").notNull(),
    contentSnapshot: text("content_snapshot"),
    resolved: integer("resolved", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [
    index("file_comments_workspace_id_file_path_idx").on(
      table.workspaceId,
      table.filePath,
    ),
  ],
);

export const cachedSessions = sqliteTable(
  "cached_sessions",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    title: text("title"),
    parentId: text("parent_id"),
    status: text("status"),
    createdAt: integer("created_at"),
    updatedAt: integer("updated_at"),
    cachedAt: integer("cached_at").notNull(),
  },
  (table) => [
    index("cached_sessions_workspace_id_cached_at_idx").on(
      table.workspaceId,
      table.cachedAt,
    ),
  ],
);

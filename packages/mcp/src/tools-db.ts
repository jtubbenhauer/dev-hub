import { type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { db, sqliteDb } from "./db.js";
import { sql } from "drizzle-orm";

interface WorkspaceRow {
  id: string;
  name: string;
  path: string;
  type: string;
  backend: string;
  color: string | null;
  linkedTaskId: string | null;
  linkedTaskMeta: string | null;
  packageManager: string | null;
  opencodeUrl: string | null;
  createdAt: number;
  lastAccessedAt: number;
}

interface SessionNoteRow {
  workspaceId: string;
  sessionId: string;
  note: string;
  createdAt: number;
}

interface CachedSessionRow {
  id: string;
  workspaceId: string;
  title: string | null;
  parentId: string | null;
  status: string | null;
  createdAt: number | null;
  updatedAt: number | null;
}

interface CommandHistoryRow {
  id: number;
  workspaceId: string;
  command: string;
  exitCode: number | null;
  executedAt: number;
}

interface CachedMessageRow {
  sessionId: string;
  workspaceId: string;
  messagesJson: string;
  cachedAt: number;
}

interface WorkspaceNameRow {
  id: string;
  name: string;
}

// Parse an ISO 8601 date string into epoch seconds
function parseToEpochSeconds(isoDate: string): number {
  const ms = Date.parse(isoDate);
  if (isNaN(ms)) throw new Error(`Invalid date: ${isoDate}`);
  return Math.floor(ms / 1000);
}

// Parse an ISO 8601 date string into epoch milliseconds
function parseToEpochMs(isoDate: string): number {
  const ms = Date.parse(isoDate);
  if (isNaN(ms)) throw new Error(`Invalid date: ${isoDate}`);
  return ms;
}

export function registerDbTools(server: McpServer) {
  server.registerTool(
    "list_workspaces",
    {
      description:
        "List all dev-hub workspaces with their name, path, type, linked ClickUp task, color, and timestamps. Use this to get an overview of what projects exist.",
      inputSchema: {},
    },
    async () => {
      const rows = db.all<WorkspaceRow>(
        sql`SELECT id, name, path, type, backend, color, linked_task_id AS linkedTaskId, linked_task_meta AS linkedTaskMeta, package_manager AS packageManager, opencode_url AS opencodeUrl, created_at AS createdAt, last_accessed_at AS lastAccessedAt FROM workspaces ORDER BY last_accessed_at DESC`,
      );

      const workspaces = rows.map((row) => ({
        id: row.id,
        name: row.name,
        path: row.path,
        type: row.type,
        backend: row.backend,
        color: row.color,
        linkedTaskId: row.linkedTaskId,
        linkedTaskMeta: row.linkedTaskMeta
          ? JSON.parse(row.linkedTaskMeta)
          : null,
        packageManager: row.packageManager,
        opencodeUrl: row.opencodeUrl,
        createdAt: new Date(row.createdAt * 1000).toISOString(),
        lastAccessedAt: new Date(row.lastAccessedAt * 1000).toISOString(),
      }));

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(workspaces, null, 2),
          },
        ],
      };
    },
  );

  server.registerTool(
    "get_workspace",
    {
      description:
        "Get detailed information about a single workspace by its ID or name.",
      inputSchema: {
        identifier: z
          .string()
          .describe("Workspace ID or name (case-insensitive name match)"),
      },
    },
    async ({ identifier }) => {
      const row = db.get<WorkspaceRow>(
        sql`SELECT id, name, path, type, backend, color, linked_task_id AS linkedTaskId, linked_task_meta AS linkedTaskMeta, package_manager AS packageManager, opencode_url AS opencodeUrl, created_at AS createdAt, last_accessed_at AS lastAccessedAt FROM workspaces WHERE id = ${identifier} OR LOWER(name) = LOWER(${identifier}) LIMIT 1`,
      );

      if (!row) {
        return {
          content: [
            {
              type: "text" as const,
              text: `No workspace found: ${identifier}`,
            },
          ],
        };
      }

      const workspace = {
        id: row.id,
        name: row.name,
        path: row.path,
        type: row.type,
        backend: row.backend,
        color: row.color,
        linkedTaskId: row.linkedTaskId,
        linkedTaskMeta: row.linkedTaskMeta
          ? JSON.parse(row.linkedTaskMeta)
          : null,
        packageManager: row.packageManager,
        opencodeUrl: row.opencodeUrl,
        createdAt: new Date(row.createdAt * 1000).toISOString(),
        lastAccessedAt: new Date(row.lastAccessedAt * 1000).toISOString(),
      };

      return {
        content: [
          { type: "text" as const, text: JSON.stringify(workspace, null, 2) },
        ],
      };
    },
  );

  server.registerTool(
    "get_session_notes",
    {
      description:
        "Get notes attached to OpenCode sessions. Optionally filter by workspace ID, session ID, or date range.",
      inputSchema: {
        workspaceId: z.string().optional().describe("Filter by workspace ID"),
        sessionId: z.string().optional().describe("Filter by session ID"),
        since: z
          .string()
          .optional()
          .describe(
            "Only return notes created on or after this ISO 8601 date (e.g. 2025-03-30T00:00:00Z)",
          ),
        until: z
          .string()
          .optional()
          .describe(
            "Only return notes created before this ISO 8601 date (e.g. 2025-03-31T00:00:00Z)",
          ),
      },
    },
    async ({ workspaceId, sessionId, since, until }) => {
      const conditions: string[] = [];
      const params: unknown[] = [];

      if (workspaceId) {
        conditions.push("workspace_id = ?");
        params.push(workspaceId);
      }
      if (sessionId) {
        conditions.push("session_id = ?");
        params.push(sessionId);
      }
      if (since) {
        conditions.push("created_at >= ?");
        params.push(parseToEpochSeconds(since));
      }
      if (until) {
        conditions.push("created_at < ?");
        params.push(parseToEpochSeconds(until));
      }

      const where =
        conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
      const query = `SELECT workspace_id AS workspaceId, session_id AS sessionId, note, created_at AS createdAt FROM session_notes ${where} ORDER BY created_at DESC`;

      const rows = sqliteDb.prepare(query).all(...params) as SessionNoteRow[];

      const notes = rows.map((row) => ({
        workspaceId: row.workspaceId,
        sessionId: row.sessionId,
        note: row.note,
        createdAt: new Date(row.createdAt * 1000).toISOString(),
      }));

      return {
        content: [
          { type: "text" as const, text: JSON.stringify(notes, null, 2) },
        ],
      };
    },
  );

  server.registerTool(
    "get_cached_sessions",
    {
      description:
        "Get cached OpenCode session metadata from dev-hub's database. Shows session titles, statuses, and which workspace they belong to. Optionally filter by workspace ID or date range.",
      inputSchema: {
        workspaceId: z.string().optional().describe("Filter by workspace ID"),
        limit: z.number().optional().describe("Max results (default 50)"),
        since: z
          .string()
          .optional()
          .describe(
            "Only return sessions updated on or after this ISO 8601 date",
          ),
        until: z
          .string()
          .optional()
          .describe("Only return sessions updated before this ISO 8601 date"),
      },
    },
    async ({ workspaceId, limit, since, until }) => {
      const maxRows = limit ?? 50;

      const conditions: string[] = ["(title IS NULL OR title != '[lens]')"];
      const params: unknown[] = [];

      if (workspaceId) {
        conditions.push("workspace_id = ?");
        params.push(workspaceId);
      }
      if (since) {
        conditions.push("updated_at >= ?");
        params.push(parseToEpochMs(since));
      }
      if (until) {
        conditions.push("updated_at < ?");
        params.push(parseToEpochMs(until));
      }

      const where = `WHERE ${conditions.join(" AND ")}`;
      params.push(maxRows);
      const query = `SELECT id, workspace_id AS workspaceId, title, parent_id AS parentId, status, created_at AS createdAt, updated_at AS updatedAt FROM cached_sessions ${where} ORDER BY updated_at DESC LIMIT ?`;

      const rows = sqliteDb.prepare(query).all(...params) as CachedSessionRow[];

      const sessions = rows.map((row) => ({
        id: row.id,
        workspaceId: row.workspaceId,
        title: row.title,
        parentId: row.parentId,
        status: row.status,
        createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : null,
        updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : null,
      }));

      return {
        content: [
          { type: "text" as const, text: JSON.stringify(sessions, null, 2) },
        ],
      };
    },
  );

  server.registerTool(
    "get_command_history",
    {
      description:
        "Get recent shell commands executed in a workspace. Useful for understanding what a user has been doing. Omit workspaceId to query across ALL workspaces.",
      inputSchema: {
        workspaceId: z
          .string()
          .optional()
          .describe("Workspace ID. Omit to get commands from all workspaces."),
        limit: z.number().optional().describe("Max results (default 50)"),
        since: z
          .string()
          .optional()
          .describe(
            "Only return commands executed on or after this ISO 8601 date",
          ),
        until: z
          .string()
          .optional()
          .describe("Only return commands executed before this ISO 8601 date"),
      },
    },
    async ({ workspaceId, limit, since, until }) => {
      const maxRows = limit ?? 50;

      const conditions: string[] = [];
      const params: unknown[] = [];

      if (workspaceId) {
        conditions.push("workspace_id = ?");
        params.push(workspaceId);
      }
      if (since) {
        conditions.push("executed_at >= ?");
        params.push(parseToEpochSeconds(since));
      }
      if (until) {
        conditions.push("executed_at < ?");
        params.push(parseToEpochSeconds(until));
      }

      const where =
        conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
      params.push(maxRows);
      const query = `SELECT id, workspace_id AS workspaceId, command, exit_code AS exitCode, executed_at AS executedAt FROM command_history ${where} ORDER BY executed_at DESC LIMIT ?`;

      const rows = sqliteDb
        .prepare(query)
        .all(...params) as CommandHistoryRow[];

      // Build a workspace name lookup for cross-workspace queries
      let workspaceNames: Map<string, string> | null = null;
      if (!workspaceId) {
        const wsRows = db.all<WorkspaceNameRow>(
          sql`SELECT id, name FROM workspaces`,
        );
        workspaceNames = new Map(wsRows.map((r) => [r.id, r.name]));
      }

      const commands = rows.map((row) => ({
        id: row.id,
        workspaceId: row.workspaceId,
        ...(workspaceNames
          ? { workspaceName: workspaceNames.get(row.workspaceId) ?? null }
          : {}),
        command: row.command,
        exitCode: row.exitCode,
        executedAt: new Date(row.executedAt * 1000).toISOString(),
      }));

      return {
        content: [
          { type: "text" as const, text: JSON.stringify(commands, null, 2) },
        ],
      };
    },
  );

  server.registerTool(
    "get_cached_messages",
    {
      description:
        "Get cached conversation messages for a session. Returns the full message history including user prompts, AI responses, and tool calls. Use this to understand what work was actually done in a session.",
      inputSchema: {
        sessionId: z.string().describe("The session ID to get messages for"),
        workspaceId: z
          .string()
          .optional()
          .describe(
            "Workspace ID. If omitted, searches across all workspaces.",
          ),
      },
    },
    async ({ sessionId, workspaceId }) => {
      const row = workspaceId
        ? db.get<CachedMessageRow>(
            sql`SELECT session_id AS sessionId, workspace_id AS workspaceId, messages_json AS messagesJson, cached_at AS cachedAt FROM cached_messages WHERE session_id = ${sessionId} AND workspace_id = ${workspaceId}`,
          )
        : db.get<CachedMessageRow>(
            sql`SELECT session_id AS sessionId, workspace_id AS workspaceId, messages_json AS messagesJson, cached_at AS cachedAt FROM cached_messages WHERE session_id = ${sessionId}`,
          );

      if (!row) {
        return {
          content: [
            {
              type: "text" as const,
              text: `No cached messages found for session ${sessionId}`,
            },
          ],
        };
      }

      let messages: unknown[];
      try {
        messages = JSON.parse(row.messagesJson);
      } catch {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to parse cached messages for session ${sessionId} (invalid JSON)`,
            },
          ],
        };
      }

      // Extract text and tool summaries from message parts
      const summarized = messages.map((msg: unknown) => {
        const m = msg as {
          info?: { id?: string; role?: string; time?: { created?: number } };
          parts?: Array<{
            type: string;
            text?: string;
            tool?: string;
            state?: string;
          }>;
        };
        const info = m.info;
        const parts = m.parts ?? [];

        const textParts = parts
          .filter((p) => p.type === "text" && p.text)
          .map((p) => p.text!);

        const toolParts = parts
          .filter((p) => p.type === "tool")
          .map((p) => ({
            tool: p.tool ?? "unknown",
            state: p.state ?? "unknown",
          }));

        return {
          id: info?.id,
          role: info?.role,
          createdAt: info?.time?.created,
          text: textParts.join("\n").slice(0, 4000),
          toolCalls: toolParts.length > 0 ? toolParts : undefined,
        };
      });

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                sessionId: row.sessionId,
                workspaceId: row.workspaceId,
                cachedAt: new Date(row.cachedAt).toISOString(),
                messageCount: messages.length,
                messages: summarized,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );
}

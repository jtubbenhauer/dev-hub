import { type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createOpencodeClient } from "@opencode-ai/sdk";
import { db } from "./db.js";
import { sql } from "drizzle-orm";

const OPENCODE_URL = process.env.OPENCODE_URL || "http://localhost:4096";
const LENS_TITLE = "[lens]";

const client = createOpencodeClient({ baseUrl: OPENCODE_URL });

interface CachedSessionLookup {
  id: string;
  workspaceId: string;
  workspaceName: string;
}

function getWorkspaceLookup(): Map<string, CachedSessionLookup> {
  const rows = db.all<CachedSessionLookup>(
    sql`SELECT cs.id, cs.workspace_id, w.name as workspace_name FROM cached_sessions cs JOIN workspaces w ON cs.workspace_id = w.id`,
  );
  return new Map(rows.map((row) => [row.id, row]));
}

export function registerSessionTools(server: McpServer) {
  server.registerTool(
    "list_sessions",
    {
      description:
        "List all OpenCode sessions with their ID, title, and status. Shows what coding sessions are active, idle, or errored across all workspaces. Includes workspace name and ID for each session when available. Excludes the lens's own session.",
      inputSchema: {},
    },
    async () => {
      try {
        const [sessionsResponse, statusResponse] = await Promise.all([
          client.session.list(),
          client.session.status(),
        ]);

        const sessions = sessionsResponse.data ?? [];
        const statuses = statusResponse.data ?? {};
        const workspaceLookup = getWorkspaceLookup();

        const result = sessions
          .filter((session) => session.title !== LENS_TITLE)
          .map((session) => {
            const cached = workspaceLookup.get(session.id);
            return {
              id: session.id,
              title: session.title ?? "(untitled)",
              parentId: session.parentID ?? null,
              workspaceId: cached?.workspaceId ?? null,
              workspaceName: cached?.workspaceName ?? null,
              createdAt: session.time.created,
              updatedAt: session.time.updated,
              status: statuses[session.id] ?? "unknown",
            };
          });

        return {
          content: [
            { type: "text" as const, text: JSON.stringify(result, null, 2) },
          ],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to list sessions: ${message}. Is OpenCode running at ${OPENCODE_URL}?`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "get_session_messages",
    {
      description:
        "Get the message history for a specific OpenCode session. Shows the conversation between user and AI including tool calls. Use this to understand what work was done in a session.",
      inputSchema: {
        sessionId: z.string().describe("The session ID"),
        limit: z
          .number()
          .optional()
          .describe("Max messages to return (default 50, most recent first)"),
      },
    },
    async ({ sessionId, limit }) => {
      try {
        const response = await client.session.messages({
          path: { id: sessionId },
          query: { limit: limit ?? 50 },
        });

        const messages = response.data ?? [];

        const result = messages.map((msg) => {
          const info = msg.info;
          const parts = msg.parts ?? [];

          const textParts = parts
            .filter((p) => p.type === "text")
            .map((p) => ("text" in p ? p.text : ""));

          const toolParts = parts
            .filter((p) => p.type === "tool")
            .map((p) => ({
              tool: "tool" in p ? p.tool : "unknown",
              state: "state" in p ? p.state : "unknown",
            }));

          return {
            id: info.id,
            role: info.role,
            createdAt: info.time.created,
            text: textParts.join("\n").slice(0, 4000),
            toolCalls: toolParts.length > 0 ? toolParts : undefined,
          };
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to get messages for session ${sessionId}: ${message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}

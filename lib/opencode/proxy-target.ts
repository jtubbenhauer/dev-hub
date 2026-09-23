import { db } from "@/lib/db";
import { workspaces } from "@/drizzle/schema";
import { eq, and } from "drizzle-orm";
import { getBackend, toWorkspace } from "@/lib/workspaces/backend";
import type { Workspace } from "@/types";
import { fetchWithHeaderTimeout } from "@/lib/opencode/fetch-timeout";

// Thrown when a workspace can't be resolved or its OpenCode server can't be
// reached. Carries the HTTP status the caller should surface.
export class OpenCodeTargetError extends Error {
  constructor(
    public status: number,
    message: string,
    public detail?: string,
  ) {
    super(message);
    this.name = "OpenCodeTargetError";
  }
}

export interface OpenCodeTarget {
  serverUrl: string;
  // Local workspaces need the directory query param; remote containers are
  // pre-scoped so it stays undefined for them.
  directory?: string;
  workspace: Workspace | null;
}

// Resolves the OpenCode server URL (and directory, for local workspaces) for a
// given workspace. Shared by the generic proxy route and the windowed messages
// route so both agree on backend resolution and error semantics.
export async function resolveOpenCodeTarget(
  userId: string,
  workspaceId: string | null,
): Promise<OpenCodeTarget> {
  if (workspaceId) {
    const [row] = await db
      .select()
      .from(workspaces)
      .where(
        and(eq(workspaces.id, workspaceId), eq(workspaces.userId, userId)),
      );

    if (!row) {
      throw new OpenCodeTargetError(404, "Workspace not found");
    }

    const workspace = toWorkspace(row);
    const backend = getBackend(workspace);

    let serverUrl: string;
    try {
      serverUrl = await backend.getOpenCodeUrl();
    } catch (error) {
      throw new OpenCodeTargetError(
        503,
        "OpenCode server unavailable",
        error instanceof Error
          ? error.message
          : "Failed to start OpenCode server",
      );
    }

    const directory =
      workspace.backend !== "remote" ? workspace.path : undefined;
    return { serverUrl, directory, workspace };
  }

  // No workspace specified — fall back to the local OpenCode server.
  try {
    const { getOrStartServer } = await import("@/lib/opencode/server-pool");
    const { url } = await getOrStartServer();
    return { serverUrl: url, directory: undefined, workspace: null };
  } catch (error) {
    throw new OpenCodeTargetError(
      503,
      "OpenCode server unavailable",
      error instanceof Error
        ? error.message
        : "Failed to start OpenCode server",
    );
  }
}

export async function authorizeOpenCodeSession(
  target: OpenCodeTarget,
  sessionId: string,
): Promise<void> {
  if (!target.directory) return;

  const sessionUrl = new URL(`/session/${sessionId}`, target.serverUrl);
  sessionUrl.searchParams.set("directory", target.directory);
  let response: Response;
  try {
    response = await fetchWithHeaderTimeout(
      sessionUrl.toString(),
      { headers: { accept: "application/json" } },
      10_000,
    );
  } catch (error) {
    throw new OpenCodeTargetError(
      503,
      "OpenCode server unavailable",
      error instanceof Error ? error.message : "Session lookup failed",
    );
  }
  if (!response.ok) {
    throw new OpenCodeTargetError(404, "Session not found");
  }

  const session: unknown = await response.json();
  if (
    typeof session !== "object" ||
    session === null ||
    !("directory" in session) ||
    typeof session.directory !== "string" ||
    session.directory !== target.directory
  ) {
    throw new OpenCodeTargetError(404, "Session not found");
  }
}

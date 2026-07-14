import { db } from "@/lib/db";
import { workspaces } from "@/drizzle/schema";
import { eq, and } from "drizzle-orm";
import { getBackend, toWorkspace } from "@/lib/workspaces/backend";
import type { Workspace } from "@/types";

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

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db";
import { workspaces } from "@/drizzle/schema";
import { eq, and } from "drizzle-orm";
import {
  getLanguageFromFilename,
  writeFileContentIfUnchanged,
} from "@/lib/files/operations";
import { getBackend, toWorkspace } from "@/lib/workspaces/backend";

// Remote backends wrap the agent's message, so match by substring.
function getReadErrorStatus(message: string): number {
  if (message === "Path traversal denied") return 403;
  if (message === "File not found") return 404;
  if (message.includes("Binary file cannot be displayed")) return 415;
  if (message.includes("File too large")) return 413;
  return 500;
}

// GET: read file content
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const searchParams = request.nextUrl.searchParams;
  const workspaceId = searchParams.get("workspaceId");
  const filePath = searchParams.get("path");

  if (!workspaceId || !filePath) {
    return NextResponse.json(
      { error: "workspaceId and path are required" },
      { status: 400 },
    );
  }

  const [row] = await db
    .select()
    .from(workspaces)
    .where(
      and(
        eq(workspaces.id, workspaceId),
        eq(workspaces.userId, session.user.id),
      ),
    );

  if (!row) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  try {
    const backend = getBackend(toWorkspace(row));
    const { content, size } = await backend.readFile(filePath);
    const language = getLanguageFromFilename(filePath);

    return NextResponse.json({ content, size, language, path: filePath });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to read file";
    return NextResponse.json(
      { error: message },
      { status: getReadErrorStatus(message) },
    );
  }
}

// PUT: write file content
export async function PUT(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body: unknown = await request.json();
  if (
    typeof body !== "object" ||
    body === null ||
    !("workspaceId" in body) ||
    typeof body.workspaceId !== "string" ||
    !body.workspaceId ||
    !("path" in body) ||
    typeof body.path !== "string" ||
    !body.path ||
    !("content" in body) ||
    typeof body.content !== "string"
  ) {
    return NextResponse.json(
      { error: "workspaceId, path, and content are required" },
      { status: 400 },
    );
  }
  const { workspaceId, path: filePath, content } = body;
  const baseContent = "baseContent" in body ? body.baseContent : undefined;
  if (baseContent !== undefined && typeof baseContent !== "string") {
    return NextResponse.json(
      { error: "baseContent must be a string" },
      { status: 400 },
    );
  }

  const [row] = await db
    .select()
    .from(workspaces)
    .where(
      and(
        eq(workspaces.id, workspaceId),
        eq(workspaces.userId, session.user.id),
      ),
    );

  if (!row) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  try {
    const workspace = toWorkspace(row);
    if (baseContent !== undefined && workspace.backend !== "remote") {
      if (
        writeFileContentIfUnchanged(
          workspace.path,
          filePath,
          content,
          baseContent,
        ) === "stale"
      ) {
        return NextResponse.json(
          {
            error:
              "This file changed on disk since you opened it (for example by a rename). Your text is kept — copy it, then reopen the file.",
            code: "STALE_BASE",
          },
          { status: 409 },
        );
      }
    } else {
      const backend = getBackend(workspace);
      await backend.writeFile(filePath, content);
    }
    return NextResponse.json({ success: true, path: filePath });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to write file";
    const status = message === "Path traversal denied" ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db";
import { workspaces } from "@/drizzle/schema";
import { eq, and } from "drizzle-orm";
import { getLanguageFromFilename } from "@/lib/files/operations";
import { getBackend, toWorkspace } from "@/lib/workspaces/backend";

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
    const status =
      message === "Path traversal denied"
        ? 403
        : message === "File not found"
          ? 404
          : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

// PUT: write file content
export async function PUT(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { workspaceId, path: filePath, content } = body;

  if (!workspaceId || !filePath || content === undefined) {
    return NextResponse.json(
      { error: "workspaceId, path, and content are required" },
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
    await backend.writeFile(filePath, content);
    return NextResponse.json({ success: true, path: filePath });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to write file";
    const status = message === "Path traversal denied" ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

import fs from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db";
import { workspaces } from "@/drizzle/schema";
import { validatePathWithinWorkspace } from "@/lib/files/operations";

const NOT_FOUND = { error: "Not found" };

async function resolveContainedRealPath(
  workspacePath: string,
  absolutePath: string,
): Promise<string | null> {
  try {
    const [targetReal, rootReal] = await Promise.all([
      fs.promises.realpath(absolutePath),
      fs.promises.realpath(workspacePath),
    ]);
    const isContained =
      targetReal === rootReal || targetReal.startsWith(rootReal + path.sep);
    return isContained ? targetReal : null;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const searchParams = request.nextUrl.searchParams;
  const workspaceId = searchParams.get("workspaceId");
  if (!workspaceId) {
    return NextResponse.json(
      { error: "workspaceId is required" },
      { status: 400 },
    );
  }

  const [workspace] = await db
    .select()
    .from(workspaces)
    .where(
      and(
        eq(workspaces.id, workspaceId),
        eq(workspaces.userId, session.user.id),
      ),
    );
  if (!workspace) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }
  if (workspace.backend !== "local") {
    return NextResponse.json(
      { error: "Only local workspaces are supported" },
      { status: 400 },
    );
  }

  // An empty path or "." resolves to the workspace root itself.
  const requestedPath = searchParams.get("path") ?? "";
  let absolutePath: string;
  try {
    absolutePath = validatePathWithinWorkspace(workspace.path, requestedPath);
  } catch {
    return NextResponse.json(
      { error: "Path traversal denied" },
      { status: 400 },
    );
  }

  const realPath = await resolveContainedRealPath(workspace.path, absolutePath);
  if (realPath === null) {
    return NextResponse.json(NOT_FOUND, { status: 404 });
  }

  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(realPath);
  } catch {
    return NextResponse.json(NOT_FOUND, { status: 404 });
  }
  const isFile = stat.isFile();
  if (!isFile && !stat.isDirectory()) {
    return NextResponse.json(NOT_FOUND, { status: 404 });
  }

  const metadata = {
    type: isFile ? "file" : "directory",
    size: stat.size,
    mtime: stat.mtimeMs,
    ctime: stat.ctimeMs,
  };
  if (!isFile || searchParams.get("content") !== "1") {
    return NextResponse.json(metadata);
  }
  try {
    const content = await fs.promises.readFile(realPath, "utf-8");
    return NextResponse.json({ ...metadata, content });
  } catch {
    return NextResponse.json(NOT_FOUND, { status: 404 });
  }
}

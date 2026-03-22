import fs from "node:fs";
import nodePath from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db";
import { workspaces } from "@/drizzle/schema";
import { eq, and } from "drizzle-orm";
import {
  getBackend,
  LocalBackend,
  toWorkspace,
} from "@/lib/workspaces/backend";

const PLAN_DIRECTORIES = [".opencode/plans", ".sisyphus/plans"];

export interface PlanFile {
  name: string;
  path: string;
  lastModified: string;
}

function getFileMtime(workspacePath: string, relativePath: string): Date {
  try {
    const fullPath = nodePath.resolve(workspacePath, relativePath);
    const stat = fs.statSync(fullPath);
    return stat.mtime;
  } catch {
    return new Date(0);
  }
}

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const workspaceId = request.nextUrl.searchParams.get("workspaceId");
  if (!workspaceId) {
    return NextResponse.json(
      { error: "workspaceId is required" },
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

  const workspace = toWorkspace(row);

  const directory = request.nextUrl.searchParams.get("directory");
  const isLocal = workspace.backend !== "remote";
  const resolvedPath = directory && isLocal ? directory : workspace.path;
  const backend =
    directory && isLocal ? new LocalBackend(directory) : getBackend(workspace);

  const seen = new Set<string>();
  const allFiles: PlanFile[] = [];

  for (const dir of PLAN_DIRECTORIES) {
    try {
      const entries = await backend.listDirectory(dir, 1);
      for (const entry of entries) {
        if (entry.type !== "file" || !entry.name.endsWith(".md")) continue;
        if (seen.has(entry.name)) continue;
        seen.add(entry.name);
        const relativePath = `${dir}/${entry.name}`;
        const mtime =
          isLocal && resolvedPath
            ? getFileMtime(resolvedPath, relativePath)
            : new Date();
        allFiles.push({
          name: entry.name,
          path: relativePath,
          lastModified: mtime.toISOString(),
        });
      }
    } catch {
      // Directory doesn't exist, skip
    }
  }

  // Most recently modified first
  allFiles.sort(
    (a, b) =>
      new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime(),
  );
  return NextResponse.json({ files: allFiles });
}

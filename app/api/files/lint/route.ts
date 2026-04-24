import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db";
import { workspaces } from "@/drizzle/schema";
import { eq, and } from "drizzle-orm";
import { toWorkspace } from "@/lib/workspaces/backend";
import { lintFile, LintServiceError } from "@/lib/editor/lint-service";
import { LINTABLE_EXTENSIONS } from "@/lib/editor/diagnostics";

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { workspaceId, filePath } = body as {
    workspaceId?: string;
    filePath?: string;
  };

  if (!workspaceId || !filePath) {
    return NextResponse.json(
      { error: "workspaceId and filePath are required" },
      { status: 400 },
    );
  }

  const ext = path.extname(filePath) as (typeof LINTABLE_EXTENSIONS)[number];
  if (!(LINTABLE_EXTENSIONS as readonly string[]).includes(ext)) {
    return NextResponse.json(
      { error: `Unsupported file type: ${ext}`, code: "UNSUPPORTED_FILE" },
      { status: 200 },
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

  const ws = toWorkspace(row);

  if (ws.backend !== "local") {
    return NextResponse.json(
      {
        error: "Lint is only supported for local workspaces",
        code: "LINT_FAILED",
      },
      { status: 400 },
    );
  }

  const resolvedPath = path.resolve(ws.path, filePath);
  if (!resolvedPath.startsWith(path.resolve(ws.path))) {
    return NextResponse.json(
      { error: "Path traversal denied" },
      { status: 403 },
    );
  }

  try {
    const result = await lintFile({
      workspacePath: ws.path,
      absoluteFilePath: resolvedPath,
      filePath,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof LintServiceError) {
      if (error.code === "NO_CONFIG") {
        return NextResponse.json(
          { error: error.message, code: "NO_CONFIG" },
          { status: 200 },
        );
      }
      if (error.code === "TIMEOUT") {
        return NextResponse.json(
          { error: "ESLint timed out", code: "TIMEOUT" },
          { status: 504 },
        );
      }
      return NextResponse.json(
        { error: error.message, code: "LINT_FAILED" },
        { status: 500 },
      );
    }
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

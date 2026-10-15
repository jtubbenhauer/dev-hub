import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db";
import { workspaces } from "@/drizzle/schema";
import { eq, and } from "drizzle-orm";
import { parseContentSearchParams } from "@devhub/shared";
import type { ContentSearchOutcome } from "@devhub/shared";
import { getBackend, toWorkspace } from "@/lib/workspaces/backend";

function contentSearchStatus(
  outcome: ContentSearchOutcome,
): 200 | 400 | 500 | 503 {
  switch (outcome.kind) {
    case "ok":
      return 200;
    case "invalid-pattern":
      return 400;
    case "unavailable":
      return 503;
    case "failed":
      return 500;
    default: {
      const unreachable: never = outcome;
      return unreachable;
    }
  }
}

// GET: find-in-files content search
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

  const parsed = parseContentSearchParams(searchParams);
  if (parsed.kind === "invalid") {
    return NextResponse.json(
      { kind: "invalid-pattern", message: parsed.message },
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
    const outcome = await backend.searchContent(parsed.query, request.signal);
    return NextResponse.json(outcome, {
      status: contentSearchStatus(outcome),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Search failed";
    return NextResponse.json({ kind: "failed", message }, { status: 500 });
  }
}

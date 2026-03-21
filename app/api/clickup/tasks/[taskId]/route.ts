import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db";
import { settings } from "@/drizzle/schema";
import { eq, and } from "drizzle-orm";
import type { ClickUpTaskDetail } from "@/types";

const CLICKUP_API_BASE = "https://api.clickup.com/api/v2";

async function getSetting(userId: string, key: string): Promise<string | null> {
  const [row] = await db
    .select()
    .from(settings)
    .where(and(eq(settings.userId, userId), eq(settings.key, key)));
  const value = row?.value;
  return typeof value === "string" && value.length > 0 ? value : null;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const token = await getSetting(session.user.id, "clickup-api-token");
  if (!token) {
    return NextResponse.json(
      { error: "ClickUp not configured" },
      { status: 422 },
    );
  }

  const { taskId } = await params;

  const url = new URL(`${CLICKUP_API_BASE}/task/${taskId}`);
  url.searchParams.set("include_markdown_description", "true");

  try {
    const upstream = await fetch(url.toString(), {
      headers: { Authorization: token },
    });

    if (!upstream.ok) {
      const body: unknown = await upstream.json().catch(() => ({}));
      return NextResponse.json(
        { error: "ClickUp API error", detail: body },
        { status: upstream.status },
      );
    }

    const task = (await upstream.json()) as ClickUpTaskDetail;
    return NextResponse.json({ task });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Request failed";
    console.error(`[clickup] task detail fetch failed (${taskId}): ${message}`);
    return NextResponse.json(
      { error: "Failed to fetch task", detail: message },
      { status: 502 },
    );
  }
}

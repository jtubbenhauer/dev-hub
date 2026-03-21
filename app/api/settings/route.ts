import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db";
import { settings } from "@/drizzle/schema";
import { eq } from "drizzle-orm";

// GET: return all settings for the authenticated user
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let rows: { userId: string; key: string; value: unknown }[];
  try {
    rows = await db
      .select()
      .from(settings)
      .where(eq(settings.userId, session.user.id));
  } catch (err) {
    console.error("[settings GET] DB error:", err);
    return NextResponse.json(
      { error: "Failed to load settings" },
      { status: 500 },
    );
  }

  const result: Record<string, unknown> = {};
  for (const row of rows) {
    result[row.key] = row.value;
  }

  return NextResponse.json(result);
}

// PUT: upsert a single setting key-value pair
export async function PUT(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON in request body" },
      { status: 400 },
    );
  }
  if (
    !body ||
    typeof body !== "object" ||
    !("key" in body) ||
    typeof (body as { key: unknown }).key !== "string"
  ) {
    return NextResponse.json(
      { error: "Request body must include a string 'key'" },
      { status: 400 },
    );
  }

  const { key, value } = body as { key: string; value: unknown };

  try {
    await db
      .insert(settings)
      .values({ userId: session.user.id, key, value })
      .onConflictDoUpdate({
        target: [settings.userId, settings.key],
        set: { value },
      });
  } catch (err) {
    console.error("[settings PUT] DB error:", err);
    return NextResponse.json(
      { error: "Failed to save setting" },
      { status: 500 },
    );
  }

  return NextResponse.json({ key, value });
}

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth/config"
import { db } from "@/lib/db"
import { settings } from "@/drizzle/schema"
import { eq, and } from "drizzle-orm"

// GET: return all settings for the authenticated user
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const rows = await db
    .select()
    .from(settings)
    .where(eq(settings.userId, session.user.id))

  const result: Record<string, unknown> = {}
  for (const row of rows) {
    result[row.key] = row.value
  }

  return NextResponse.json(result)
}

// PUT: upsert a single setting key-value pair
export async function PUT(request: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body: unknown = await request.json()
  if (
    !body ||
    typeof body !== "object" ||
    !("key" in body) ||
    typeof (body as { key: unknown }).key !== "string"
  ) {
    return NextResponse.json(
      { error: "Request body must include a string 'key'" },
      { status: 400 }
    )
  }

  const { key, value } = body as { key: string; value: unknown }

  const existing = await db
    .select()
    .from(settings)
    .where(and(eq(settings.userId, session.user.id), eq(settings.key, key)))

  if (existing.length > 0) {
    await db
      .update(settings)
      .set({ value: value as never })
      .where(and(eq(settings.userId, session.user.id), eq(settings.key, key)))
  } else {
    await db.insert(settings).values({
      userId: session.user.id,
      key,
      value: value as never,
    })
  }

  return NextResponse.json({ key, value })
}

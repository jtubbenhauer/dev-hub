import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { users } from "@/drizzle/schema"
import { hash } from "bcryptjs"
import crypto from "node:crypto"

export async function GET() {
  const allUsers = await db.select().from(users)
  return NextResponse.json({
    needsSetup: allUsers.length === 0,
    userCount: allUsers.length,
  })
}

export async function POST(request: NextRequest) {
  const body = await request.json()
  const { action } = body

  switch (action) {
    case "create-user": {
      const allUsers = await db.select().from(users)
      if (allUsers.length > 0) {
        return NextResponse.json(
          { error: "User already exists" },
          { status: 400 }
        )
      }

      const { username, password } = body
      if (!username || typeof username !== "string") {
        return NextResponse.json(
          { error: "Username is required" },
          { status: 400 }
        )
      }
      if (!password || typeof password !== "string" || password.length < 8) {
        return NextResponse.json(
          { error: "Password must be at least 8 characters" },
          { status: 400 }
        )
      }

      const userId = crypto.randomUUID()
      const passwordHash = await hash(password, 12)
      await db.insert(users).values({ id: userId, username, passwordHash })

      return NextResponse.json({ userId, username })
    }

    default:
      return NextResponse.json(
        { error: "Unknown action" },
        { status: 400 }
      )
  }
}

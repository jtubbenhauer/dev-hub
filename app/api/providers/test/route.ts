import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth/config"
import { exec } from "node:child_process"

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
  }

  const binaryPath = body.binaryPath
  if (!binaryPath || typeof binaryPath !== "string") {
    return NextResponse.json({ error: "binaryPath is required" }, { status: 400 })
  }

  const trimmed = binaryPath.trim()

  try {
    const isExecutable = await new Promise<boolean>((resolve) => {
      exec(`command -v "${trimmed}"`, (error) => {
        resolve(!error)
      })
    })

    if (isExecutable) {
      return NextResponse.json({ ok: true })
    }

    return NextResponse.json({ ok: false, error: "Binary not found or not executable" })
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to verify binary" })
  }
}

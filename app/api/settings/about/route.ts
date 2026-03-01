import { NextResponse } from "next/server"
import { auth } from "@/lib/auth/config"
import { execSync } from "node:child_process"
import os from "node:os"

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let gitVersion = "unknown"
  try {
    gitVersion = execSync("git --version", { encoding: "utf-8" }).trim().replace("git version ", "")
  } catch {
    // git not available
  }

  return NextResponse.json({
    os: `${os.type()} ${os.release()} (${os.arch()})`,
    nodeVersion: process.version,
    gitVersion,
  })
}

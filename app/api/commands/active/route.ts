import { NextResponse } from "next/server"
import { auth } from "@/lib/auth/config"
import { listActiveProcesses } from "@/lib/commands/process-manager"

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const processes = listActiveProcesses()
  return NextResponse.json({ processes })
}

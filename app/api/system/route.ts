import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth/config"
import { getSystemStats, getSystemStatsWithHistory } from "@/lib/system/stats"

export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { searchParams } = request.nextUrl
  const includeHistory = searchParams.get("history") === "true"

  try {
    if (includeHistory) {
      const data = await getSystemStatsWithHistory()
      return NextResponse.json(data)
    }

    const data = await getSystemStats()
    return NextResponse.json(data)
  } catch (error) {
    console.error("System stats error:", error)
    return NextResponse.json(
      { error: "Failed to collect system stats" },
      { status: 500 }
    )
  }
}

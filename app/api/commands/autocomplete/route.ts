import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth/config"
import { db } from "@/lib/db"
import { workspaces } from "@/drizzle/schema"
import { eq } from "drizzle-orm"
import { getSuggestions } from "@/lib/commands/autocomplete"

export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { searchParams } = request.nextUrl
  const workspaceId = searchParams.get("workspaceId")
  const query = searchParams.get("q") ?? ""

  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId is required" }, { status: 400 })
  }

  const [workspace] = await db
    .select({ path: workspaces.path, userId: workspaces.userId })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1)

  if (!workspace || workspace.userId !== session.user.id) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 })
  }

  const suggestions = await getSuggestions(workspaceId, workspace.path, query)

  return NextResponse.json({ suggestions })
}

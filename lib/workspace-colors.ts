import { db } from "@/lib/db"
import { settings, workspaces } from "@/drizzle/schema"
import { eq, and } from "drizzle-orm"
import { pickNextColor, assignColorsToUncolored } from "@/lib/workspace-color-utils"

export { pickNextColor, assignColorsToUncolored }

export async function getAutoColorForNewWorkspace(userId: string): Promise<string | null> {
  const [settingRow] = await db
    .select({ value: settings.value })
    .from(settings)
    .where(
      and(
        eq(settings.userId, userId),
        eq(settings.key, "auto-color-workspaces")
      )
    )
  // Default is enabled (true) when no setting exists
  if (settingRow?.value === false) return null

  const existingWorkspaces = await db
    .select({ id: workspaces.id, color: workspaces.color })
    .from(workspaces)
    .where(eq(workspaces.userId, userId))

  return pickNextColor(existingWorkspaces)
}

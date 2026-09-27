import { and, eq } from "drizzle-orm";
import { settings, workspaces } from "@/drizzle/schema";
import { db } from "@/lib/db";
import {
  CHAT_ENGINE_SETTING_KEY,
  isChatEngine,
  type ChatEngine,
} from "@/lib/engine/types";

export async function resolveWorkspaceEngine(
  userId: string,
  workspaceId: string | null,
): Promise<ChatEngine> {
  const [workspace] = workspaceId
    ? await db
        .select({ engine: workspaces.engine })
        .from(workspaces)
        .where(
          and(eq(workspaces.id, workspaceId), eq(workspaces.userId, userId)),
        )
        .limit(1)
    : [];
  const [globalSetting] = await db
    .select({ value: settings.value })
    .from(settings)
    .where(
      and(
        eq(settings.userId, userId),
        eq(settings.key, CHAT_ENGINE_SETTING_KEY),
      ),
    )
    .limit(1);
  const selected = workspace?.engine ?? globalSetting?.value ?? "opencode";
  return isChatEngine(selected) ? selected : "opencode";
}

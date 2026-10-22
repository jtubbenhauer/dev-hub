import { and, eq } from "drizzle-orm";
import { settings } from "@/drizzle/schema";
import { CHAT_SUGGESTIONS_ENABLED_SETTING_KEY } from "@/lib/chat-suggest/constants";
import { db } from "@/lib/db";

export async function isChatSuggestionsEnabledForUser(
  userId: string,
): Promise<boolean> {
  const rows = await db
    .select({ value: settings.value })
    .from(settings)
    .where(
      and(
        eq(settings.userId, userId),
        eq(settings.key, CHAT_SUGGESTIONS_ENABLED_SETTING_KEY),
      ),
    );
  return rows[0]?.value !== false;
}

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db";
import { settings } from "@/drizzle/schema";
import { CHAT_SUGGESTIONS_ENABLED_SETTING_KEY } from "@/lib/chat-suggest/constants";
import {
  requestChatCompletion,
  resolveChatSuggestConfig,
} from "@/lib/chat-suggest/llm";
import {
  buildLiveCompletionMessages,
  buildReplySuggestionMessages,
  extractCompletionFromFullMessage,
  parseReplySuggestions,
} from "@/lib/chat-suggest/prompts";

interface ChatSuggestRequestBody {
  mode: "replies" | "complete";
  lastAgentMessage: string;
  recentUserMessages: string[];
  typedText?: string;
}

function parseRequestBody(body: unknown): ChatSuggestRequestBody | null {
  if (typeof body !== "object" || body === null) return null;
  const { mode, lastAgentMessage, recentUserMessages, typedText } =
    body as Record<string, unknown>;
  if (mode !== "replies" && mode !== "complete") return null;
  if (typeof lastAgentMessage !== "string" || !lastAgentMessage) return null;
  if (
    !Array.isArray(recentUserMessages) ||
    !recentUserMessages.every((item) => typeof item === "string")
  ) {
    return null;
  }
  if (mode === "complete") {
    if (typeof typedText !== "string" || !typedText.trim()) return null;
    return { mode, lastAgentMessage, recentUserMessages, typedText };
  }
  return { mode, lastAgentMessage, recentUserMessages };
}

async function isChatSuggestionsEnabledForUser(
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

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = parseRequestBody(await request.json().catch(() => null));
  if (!body) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  // Enforced server-side too, so disabling guarantees no conversation text leaves the machine
  if (!(await isChatSuggestionsEnabledForUser(session.user.id))) {
    return NextResponse.json({ disabled: true }, { status: 403 });
  }

  const config = await resolveChatSuggestConfig();
  if (!config) {
    return NextResponse.json({ disabled: true }, { status: 503 });
  }

  const promptInput = {
    lastAgentMessage: body.lastAgentMessage,
    recentUserMessages: body.recentUserMessages,
  };

  try {
    if (body.mode === "replies") {
      const raw = await requestChatCompletion(
        config,
        buildReplySuggestionMessages(promptInput),
        { maxTokens: 800, temperature: 0.4, signal: request.signal },
      );
      return NextResponse.json({ replies: parseReplySuggestions(raw) });
    }

    const typedText = body.typedText ?? "";
    const raw = await requestChatCompletion(
      config,
      buildLiveCompletionMessages({ ...promptInput, typedText }),
      { maxTokens: 400, temperature: 0.2, signal: request.signal },
    );
    return NextResponse.json({
      completion: extractCompletionFromFullMessage(typedText, raw),
    });
  } catch (error) {
    if (request.signal.aborted) {
      return NextResponse.json({ error: "Aborted" }, { status: 499 });
    }
    console.error("[chat-suggest]", error);
    return NextResponse.json(
      { error: "Suggestion request failed" },
      { status: 502 },
    );
  }
}

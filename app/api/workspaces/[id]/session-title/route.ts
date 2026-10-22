import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { workspaces } from "@/drizzle/schema";
import { auth } from "@/lib/auth/config";
import {
  requestChatCompletion,
  resolveChatSuggestConfig,
} from "@/lib/chat-suggest/llm";
import { isChatSuggestionsEnabledForUser } from "@/lib/chat-suggest/settings";
import { db } from "@/lib/db";
import { AUTO_TITLE_USER_TURNS } from "@/lib/session-title/context";
import {
  buildSessionTitleMessages,
  parseGeneratedTitle,
} from "@/lib/session-title/prompts";
import {
  claimAutoTitleTurn,
  recordGeneratedTitle,
} from "@/lib/session-title/title-state";
import { titleFromUserText } from "@/lib/session-title/title-text";

interface RouteParams {
  params: Promise<{ id: string }>;
}

type SessionTitleTrigger =
  | { kind: "auto"; turn: number }
  | { kind: "regenerate" };

interface SessionTitleRequestBody {
  sessionId: string;
  trigger: SessionTitleTrigger;
  currentTitle: string;
  userTurnCount: number;
  sessionSpanMs: number | null;
  userMessages: string[];
  agentMessages: string[];
}

const MAX_USER_MESSAGES = 24;
const MAX_AGENT_MESSAGES = 5;
const MAX_MESSAGE_CHARS = 4000;

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

function parseTrigger(
  value: unknown,
  turn: unknown,
): SessionTitleTrigger | null {
  if (value === "regenerate") return { kind: "regenerate" };
  if (value === "auto" && typeof turn === "number" && Number.isInteger(turn)) {
    return { kind: "auto", turn };
  }
  return null;
}

function parseRequestBody(body: unknown): SessionTitleRequestBody | null {
  if (typeof body !== "object" || body === null) return null;
  const {
    sessionId,
    trigger,
    turn,
    currentTitle,
    userMessages,
    agentMessages,
    userTurnCount,
    sessionSpanMs,
  } = body as Record<string, unknown>;
  const parsedTrigger = parseTrigger(trigger, turn);
  if (typeof sessionId !== "string" || !sessionId || parsedTrigger === null) {
    return null;
  }
  if (
    typeof currentTitle !== "string" ||
    !isStringArray(agentMessages) ||
    !isStringArray(userMessages) ||
    userMessages.length === 0
  ) {
    return null;
  }
  return {
    sessionId,
    trigger: parsedTrigger,
    currentTitle,
    // A tab still running an older build sends neither field.
    userTurnCount:
      typeof userTurnCount === "number" &&
      Number.isInteger(userTurnCount) &&
      userTurnCount > 0
        ? userTurnCount
        : userMessages.length,
    sessionSpanMs:
      typeof sessionSpanMs === "number" &&
      Number.isFinite(sessionSpanMs) &&
      sessionSpanMs >= 0
        ? sessionSpanMs
        : null,
    userMessages: userMessages
      .slice(0, MAX_USER_MESSAGES)
      .map((message) => message.slice(0, MAX_MESSAGE_CHARS)),
    agentMessages: agentMessages
      .slice(-MAX_AGENT_MESSAGES)
      .map((message) => message.slice(0, MAX_MESSAGE_CHARS)),
  };
}

// The names a chat has before anyone titles it: omo's and OpenCode's defaults.
function isPlaceholderTitle(title: string): boolean {
  const trimmed = title.trim();
  return (
    trimmed === "" ||
    trimmed === "Untitled" ||
    /^(New|Child) session - /.test(trimmed)
  );
}

async function isWorkspaceOwnedBy(
  workspaceId: string,
  userId: string,
): Promise<boolean> {
  const [workspace] = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(and(eq(workspaces.id, workspaceId), eq(workspaces.userId, userId)));
  return workspace !== undefined;
}

async function generateTitleWithModel(
  userId: string,
  body: SessionTitleRequestBody,
  signal: AbortSignal,
): Promise<{ title: string | null; isModelAvailable: boolean }> {
  // Disabling chat suggestions guarantees no conversation text leaves the machine.
  const config = (await isChatSuggestionsEnabledForUser(userId))
    ? await resolveChatSuggestConfig()
    : null;
  if (!config) return { title: null, isModelAvailable: false };
  const raw = await requestChatCompletion(
    config,
    buildSessionTitleMessages(body),
    { maxTokens: 200, temperature: 0.2, signal },
  );
  return { title: parseGeneratedTitle(raw), isModelAvailable: true };
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;
  const { id: workspaceId } = await params;
  if (!(await isWorkspaceOwnedBy(workspaceId, userId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const body = parseRequestBody(await request.json().catch(() => null));
  if (!body) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const { trigger } = body;
  if (trigger.kind === "auto") {
    if (!AUTO_TITLE_USER_TURNS.includes(trigger.turn)) {
      return NextResponse.json({ skipped: "not_a_title_turn" });
    }
    const claim = claimAutoTitleTurn(
      workspaceId,
      body.sessionId,
      trigger.turn,
      body.currentTitle,
    );
    if (claim !== "claimed") return NextResponse.json({ skipped: claim });
  }

  let generated: { title: string | null; isModelAvailable: boolean };
  try {
    generated = await generateTitleWithModel(userId, body, request.signal);
  } catch (error) {
    if (request.signal.aborted) {
      return NextResponse.json({ error: "Aborted" }, { status: 499 });
    }
    console.error("[session-title]", error);
    return NextResponse.json(
      { error: "The title model request failed" },
      { status: 502 },
    );
  }

  let title = generated.title;
  if (
    title === null &&
    trigger.kind === "auto" &&
    isPlaceholderTitle(body.currentTitle)
  ) {
    title = titleFromUserText(body.userMessages[0] ?? "");
  }
  if (title === null) {
    if (trigger.kind === "auto") {
      return NextResponse.json({ skipped: "no_title" });
    }
    return NextResponse.json(
      {
        error: generated.isModelAvailable
          ? "The title model returned no title"
          : "Title generation needs chat suggestions enabled and an OpenRouter API key",
      },
      { status: generated.isModelAvailable ? 502 : 503 },
    );
  }

  recordGeneratedTitle(workspaceId, body.sessionId, title);
  return NextResponse.json({ title });
}

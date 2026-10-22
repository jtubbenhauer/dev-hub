import type { ChatSuggestMessage } from "@/lib/chat-suggest/prompts";
import { SESSION_TITLE_MAX_CHARS } from "@/lib/session-title/title-text";

export interface SessionTitlePromptInput {
  userTurnCount: number;
  sessionSpanMs: number | null;
  userMessages: string[];
  agentMessages: string[];
}

const SYSTEM_PROMPT = [
  "You name chat sessions between a developer and a coding agent.",
  "Reply with only the title: 3 to 8 words, sentence case, no quotes, no trailing punctuation.",
  "Name the theme that runs through the whole session: the product area or problem the developer keeps coming back to.",
  "Prefer that theme over any single task, step, round, fix or deliverable inside it. For example 'Checkout payment retry reliability', not 'Fix retry test flake' or 'Deploy checkout to staging'.",
  "The developer messages are a sample spread across the session, oldest first. Deploying, committing, merging, checking progress or a side question near the end does not change the theme.",
  "Only name a newer theme when the developer has clearly moved on to different work for a large share of the session.",
  "Use the concrete names involved, such as product areas, features or PR numbers, instead of generic words like help, question or request. Never use a title that could fit any session, such as 'Production release preparation'.",
].join(" ");

const HOUR_MS = 60 * 60 * 1000;

export function describeSessionLength(
  userTurnCount: number,
  sessionSpanMs: number | null,
): string {
  const messages = `${userTurnCount} developer ${userTurnCount === 1 ? "message" : "messages"}`;
  if (sessionSpanMs === null || userTurnCount < 2) return messages;
  const hours = sessionSpanMs / HOUR_MS;
  if (hours < 1) return `${messages} within an hour`;
  if (hours < 48) return `${messages} over ${Math.round(hours)} hours`;
  return `${messages} over ${(hours / 24).toFixed(1)} days`;
}

function numbered(messages: readonly string[]): string {
  return messages
    .map((message, index) => `<message ${index + 1}>\n${message}`)
    .join("\n\n");
}

export function buildSessionTitleMessages({
  userTurnCount,
  sessionSpanMs,
  userMessages,
  agentMessages,
}: SessionTitlePromptInput): ChatSuggestMessage[] {
  const agentSection =
    agentMessages.length > 0
      ? [
          "",
          '<agent_recent_messages note="oldest first">',
          numbered(agentMessages),
          "</agent_recent_messages>",
        ]
      : [];
  return [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: [
        `<session length="${describeSessionLength(userTurnCount, sessionSpanMs)}" />`,
        '<developer_messages note="spread across the session, oldest first">',
        numbered(userMessages),
        "</developer_messages>",
        ...agentSection,
      ].join("\n"),
    },
  ];
}

const LEADING_TITLE_LABEL = /^title:\s*/i;
const WRAPPING_QUOTES = /^["'`*\u201C\u2018]+|["'`*\u201D\u2019]+$/g;
const TRAILING_PERIODS = /\.+$/;

export function parseGeneratedTitle(raw: string): string | null {
  const firstLine = raw
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstLine) return null;
  const title = firstLine
    .replace(LEADING_TITLE_LABEL, "")
    .replace(WRAPPING_QUOTES, "")
    .replace(TRAILING_PERIODS, "")
    .trim();
  if (!title) return null;
  return title.slice(0, SESSION_TITLE_MAX_CHARS).trimEnd();
}

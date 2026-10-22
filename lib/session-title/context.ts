import type { MessageWithParts } from "@/lib/opencode/types";
import {
  getVisibleText,
  stripInjectedContext,
} from "@/lib/chat-suggest/context";

export const AUTO_TITLE_USER_TURNS: readonly number[] = [1, 3];

const MIN_SUBSTANTIAL_USER_CHARS = 15;
const MIN_SAMPLED_USER_MESSAGES = 7;
const MAX_SAMPLED_USER_MESSAGES = 20;
const USER_MESSAGES_PER_SAMPLE = 5;
const RECENT_USER_MESSAGES = 3;
const MAX_USER_MESSAGE_CHARS = 400;
const LONG_SESSION_USER_TURNS = 12;
const SHORT_SESSION_AGENT_MESSAGES = 2;
const MAX_AGENT_MESSAGE_CHARS = 500;

export interface SessionTitleContext {
  userTurnCount: number;
  sessionSpanMs: number | null;
  userMessages: string[];
  agentMessages: string[];
}

const SKILL_INVOCATION_PREFIX =
  /^The user explicitly invoked the "[^"]+" skill\./;
const SKILL_USER_REQUEST = /<user-request>([\s\S]*?)<\/user-request>/;
const LEADING_SKILL_TOKEN = /^\$[\w:-]+\s+/;
// Blocks omo and senpi add to a user turn; none are the developer's words.
const AGENT_INJECTED_BLOCK =
  /<(skill-instruction|system-reminder|environment_context|omo-[\w-]+)\b[^>]*>[\s\S]*?<\/\1>/g;
const UNANSWERED_QUESTION =
  /^\[Answer to question [^\]]*\]\s*The user did not answer within/;
const QUESTION_ANSWER_LABEL =
  /^\[(?:Answer to question|The user's answer to)[^\]]*\]$/;
const QUESTION_ANSWER_POINTER =
  /\(see \[The user's answer to [^\]]*\] below\)/g;

export function developerTextOf(text: string): string {
  const request = SKILL_INVOCATION_PREFIX.test(text)
    ? (SKILL_USER_REQUEST.exec(text)?.[1] ?? "")
    : text;
  if (UNANSWERED_QUESTION.test(request)) return "";
  const withoutInjections = stripInjectedContext(
    request.replace(AGENT_INJECTED_BLOCK, ""),
  );
  return withoutInjections
    .replace(QUESTION_ANSWER_POINTER, "")
    .split("\n")
    .filter((line) => !QUESTION_ANSWER_LABEL.test(line.trim()))
    .join("\n")
    .replace(LEADING_SKILL_TOKEN, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Keeps both ends: the ask usually leads, and the detail that names it trails.
function excerpt(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const headChars = Math.ceil(maxChars * 0.7);
  return `${text.slice(0, headChars)} … ${text.slice(-(maxChars - headChars))}`;
}

interface DeveloperMessage {
  text: string;
  createdAt: number | undefined;
}

function longest(messages: readonly DeveloperMessage[]): DeveloperMessage {
  return messages.reduce((best, message) =>
    message.text.length > best.text.length ? message : best,
  );
}

// A long session is split into equal slices and the most substantial message
// of each slice is kept, so the sample covers the whole session rather than
// its tail. One-word replies only count when nothing longer exists.
function sampleTitleMessages(
  messages: readonly DeveloperMessage[],
): DeveloperMessage[] {
  const substantial = messages.filter(
    ({ text }) => text.length >= MIN_SUBSTANTIAL_USER_CHARS,
  );
  const pool = substantial.length > 0 ? substantial : messages;
  const sampleSize = Math.min(
    MAX_SAMPLED_USER_MESSAGES,
    Math.max(
      MIN_SAMPLED_USER_MESSAGES,
      Math.ceil(pool.length / USER_MESSAGES_PER_SAMPLE),
    ),
  );
  const recent = pool.slice(-RECENT_USER_MESSAGES);
  const earlier = pool.slice(0, pool.length - recent.length);
  const sliceCount = sampleSize - recent.length;
  const sampled: DeveloperMessage[] = [];
  for (let slice = 0; slice < sliceCount; slice += 1) {
    const sliceMessages = earlier.slice(
      Math.floor((slice * earlier.length) / sliceCount),
      Math.floor(((slice + 1) * earlier.length) / sliceCount),
    );
    if (sliceMessages.length > 0) sampled.push(longest(sliceMessages));
  }
  return [...sampled, ...recent];
}

function sessionSpanMs(messages: readonly DeveloperMessage[]): number | null {
  const first = messages[0]?.createdAt;
  const last = messages.at(-1)?.createdAt;
  return first === undefined || last === undefined
    ? null
    : Math.max(0, last - first);
}

function createdAtOf(message: MessageWithParts): number | undefined {
  const created: unknown = message.info.time?.created;
  return typeof created === "number" ? created : undefined;
}

export function buildSessionTitleContext(
  messages: readonly MessageWithParts[],
): SessionTitleContext | null {
  const developerMessages = messages
    .filter((message) => message.info.role === "user")
    .map((message) => ({
      text: developerTextOf(getVisibleText(message)),
      createdAt: createdAtOf(message),
    }))
    .filter(({ text }) => text.length > 0);
  if (developerMessages.length === 0) return null;
  // On a long session the agent's latest replies describe only its tail.
  const isLongSession = developerMessages.length > LONG_SESSION_USER_TURNS;
  const agentMessages = isLongSession
    ? []
    : messages
        .filter((message) => message.info.role === "assistant")
        .map(getVisibleText)
        .filter((text) => text.length > 0)
        .slice(-SHORT_SESSION_AGENT_MESSAGES);
  return {
    userTurnCount: developerMessages.length,
    sessionSpanMs: sessionSpanMs(developerMessages),
    userMessages: sampleTitleMessages(developerMessages).map(({ text }) =>
      excerpt(text, MAX_USER_MESSAGE_CHARS),
    ),
    agentMessages: agentMessages.map((text) =>
      excerpt(text, MAX_AGENT_MESSAGE_CHARS),
    ),
  };
}

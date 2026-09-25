import type { MessageWithParts } from "@/lib/opencode/types";

export interface SuggestionContext {
  lastAgentMessageId: string;
  lastAgentMessage: string;
  recentUserMessages: string[];
}

const MAX_AGENT_MESSAGE_CHARS = 6000;
const MAX_USER_MESSAGE_CHARS = 500;
const MAX_USER_MESSAGES = 8;

// Blocks the prompt input prepends to user messages; not part of the user's voice
const INJECTED_CONTEXT_PREFIXES = ["Context files:", "Comment references:"];
// PR context spans many paragraphs, so those messages are skipped as examples
const PR_CONTEXT_PATTERN = /^PR #\d+:/;

function getVisibleText(message: MessageWithParts): string {
  return message.parts
    .flatMap((part) =>
      part.type === "text" && !part.synthetic && !part.ignored
        ? [part.text]
        : [],
    )
    .join("\n")
    .trim();
}

export function stripInjectedContext(text: string): string {
  const blocks = text.split(/\n{2,}/);
  const userBlocks = blocks.filter(
    (block) =>
      !INJECTED_CONTEXT_PREFIXES.some((prefix) =>
        block.trimStart().startsWith(prefix),
      ),
  );
  return userBlocks.join("\n\n").trim();
}

function truncateFromStart(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  // Agent summaries put the actionable bit at the end, so keep the tail
  return "…" + text.slice(text.length - maxChars);
}

function truncateFromEnd(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + "…";
}

export function buildSuggestionContext(
  messages: MessageWithParts[],
): SuggestionContext | null {
  const lastMessage = messages.at(-1);
  if (!lastMessage || lastMessage.info.role !== "assistant") return null;

  // Last agent turn can span multiple assistant messages (tool steps);
  // the final one with text is what the user is replying to.
  let lastAgentMessageId: string | null = null;
  let lastAgentMessage = "";
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.info.role === "user") break;
    const text = getVisibleText(message);
    if (text) {
      lastAgentMessageId = message.info.id;
      lastAgentMessage = text;
      break;
    }
  }
  if (!lastAgentMessageId) return null;

  const recentUserMessages = messages
    .filter((message) => message.info.role === "user")
    .map((message) => getVisibleText(message))
    .filter((text) => !PR_CONTEXT_PATTERN.test(text))
    .map(stripInjectedContext)
    .filter((text) => text.length > 0 && !text.startsWith("/"))
    .slice(-MAX_USER_MESSAGES)
    .map((text) => truncateFromEnd(text, MAX_USER_MESSAGE_CHARS));

  return {
    lastAgentMessageId,
    lastAgentMessage: truncateFromStart(
      lastAgentMessage,
      MAX_AGENT_MESSAGE_CHARS,
    ),
    recentUserMessages,
  };
}

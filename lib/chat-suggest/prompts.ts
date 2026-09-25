export interface ChatSuggestMessage {
  role: "system" | "user";
  content: string;
}

export interface SuggestionPromptInput {
  lastAgentMessage: string;
  recentUserMessages: string[];
}

export const MAX_REPLY_SUGGESTIONS = 5;

function formatConversationContext({
  lastAgentMessage,
  recentUserMessages,
}: SuggestionPromptInput): string {
  const userExamples =
    recentUserMessages.length > 0
      ? recentUserMessages
          .map((message, index) => `<message ${index + 1}>\n${message}`)
          .join("\n\n")
      : "(none yet)";
  return [
    "<user_previous_messages>",
    userExamples,
    "</user_previous_messages>",
    "",
    "<agent_latest_message>",
    lastAgentMessage,
    "</agent_latest_message>",
  ].join("\n");
}

const VOICE_GUIDANCE =
  'You write as the developer, in first person, addressing the agent as "you". Never write as the agent and never offer to do the agent\'s work. ' +
  "Match the developer's voice from their previous messages: their length, tone, casing, punctuation and phrasing. " +
  "Be conversational and brief. Refer to things by the names the agent used.";

export function buildReplySuggestionMessages(
  input: SuggestionPromptInput,
): ChatSuggestMessage[] {
  return [
    {
      role: "system",
      content:
        "You predict the next message a developer will send to their AI coding agent. " +
        VOICE_GUIDANCE +
        `\n\nReturn a JSON array of 3 to ${MAX_REPLY_SUGGESTIONS} distinct candidate replies, most likely first. ` +
        "The first should confirm or accept what the agent recommended or asked. " +
        "The rest should cover other realistic directions the agent's message opens up, such as picking a different option, reordering, asking for detail or pushing back. " +
        "Each reply is one to two sentences. Output only the JSON array of strings.",
    },
    { role: "user", content: formatConversationContext(input) },
  ];
}

export function buildLiveCompletionMessages(
  input: SuggestionPromptInput & { typedText: string },
): ChatSuggestMessage[] {
  return [
    {
      role: "system",
      content:
        "You autocomplete the message a developer is typing to their AI coding agent. " +
        VOICE_GUIDANCE +
        "\n\nPredict the complete message the developer intends, given the conversation and what they have typed so far. " +
        "If the partial message names one of the agent's options, the developer is most likely choosing, reordering or questioning it. " +
        "Output the complete message, starting with exactly the characters already typed, and nothing else. " +
        "Keep it to one or two sentences.",
    },
    {
      role: "user",
      content:
        formatConversationContext(input) +
        `\n\n<typed_so_far>${input.typedText}</typed_so_far>`,
    },
  ];
}

export function parseReplySuggestions(raw: string): string[] {
  const arrayStart = raw.indexOf("[");
  const arrayEnd = raw.lastIndexOf("]");
  if (arrayStart === -1 || arrayEnd <= arrayStart) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(arrayStart, arrayEnd + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const uniqueReplies = new Set<string>();
  for (const item of parsed) {
    if (typeof item === "string" && item.trim()) {
      uniqueReplies.add(item.trim());
    }
  }
  return [...uniqueReplies].slice(0, MAX_REPLY_SUGGESTIONS);
}

// The model returns the whole message; keep only what follows the typed text.
export function extractCompletionFromFullMessage(
  typedText: string,
  rawFullMessage: string,
): string {
  const firstLine = rawFullMessage.trim().split("\n")[0] ?? "";
  const fullMessage = firstLine.replace(/^["'`]+|["'`]+$/g, "");
  if (!fullMessage.toLowerCase().startsWith(typedText.toLowerCase())) {
    return "";
  }
  return fullMessage.slice(typedText.length).trimEnd();
}

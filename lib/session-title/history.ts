import type { MessageWithParts } from "@/lib/opencode/types";

const HISTORY_PAGE_LIMIT = 500;
const MAX_HISTORY_PAGES = 12;
const HISTORY_PAGE_TIMEOUT_MS = 60_000;

interface MessagesPage {
  messages: MessageWithParts[];
  hasMore: boolean;
}

function isMessagesPage(value: unknown): value is MessagesPage {
  if (typeof value !== "object" || value === null) return false;
  const { messages, hasMore } = value as Record<string, unknown>;
  return (
    typeof hasMore === "boolean" &&
    Array.isArray(messages) &&
    messages.every(
      (message: unknown) =>
        typeof message === "object" &&
        message !== null &&
        typeof (message as { info?: { id?: unknown } }).info?.id === "string" &&
        Array.isArray((message as { parts?: unknown }).parts),
    )
  );
}

// Pages the older history straight from the server, leaving the chat's
// loaded window alone, so a title can see how a long chat started.
export async function loadEarlierHistory(options: {
  sessionId: string;
  workspaceId: string;
  loadedMessages: readonly MessageWithParts[];
}): Promise<MessageWithParts[]> {
  const { sessionId, workspaceId } = options;
  let messages = [...options.loadedMessages];
  for (let page = 0; page < MAX_HISTORY_PAGES; page += 1) {
    const oldest = messages[0];
    if (!oldest) break;
    const params = new URLSearchParams({
      sessionId,
      workspaceId,
      before: oldest.info.id,
      limit: String(HISTORY_PAGE_LIMIT),
    });
    const response = await fetch(`/api/sessions/messages?${params}`, {
      signal: AbortSignal.timeout(HISTORY_PAGE_TIMEOUT_MS),
    });
    if (!response.ok) break;
    const body: unknown = await response.json();
    if (!isMessagesPage(body)) break;
    const knownIds = new Set(messages.map((message) => message.info.id));
    const older = body.messages.filter(
      (message) => !knownIds.has(message.info.id),
    );
    if (older.length === 0) break;
    messages = [...older, ...messages];
    if (!body.hasMore) break;
  }
  return messages;
}

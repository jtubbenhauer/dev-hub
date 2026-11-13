export const CHAT_LIST_START_INDEX = 100_000;

export interface ChatListWindow {
  sessionId: string | null;
  firstMessageId: string | null;
  firstItemIndex: number;
}

interface ChatListMessage {
  info: { id: string };
}

// Virtuoso keeps the scroll position when older messages are prepended only
// if firstItemIndex drops by the prepended count in the same render as the
// data, so this runs during render rather than in an effect.
export function advanceChatListWindow(
  previous: ChatListWindow | null,
  sessionId: string | null,
  messages: ReadonlyArray<ChatListMessage>,
): ChatListWindow {
  const firstMessageId = messages[0]?.info.id ?? null;
  if (!previous || previous.sessionId !== sessionId) {
    return { sessionId, firstMessageId, firstItemIndex: CHAT_LIST_START_INDEX };
  }
  if (previous.firstMessageId === firstMessageId) return previous;

  const prependedCount =
    previous.firstMessageId === null
      ? -1
      : messages.findIndex(
          (message) => message.info.id === previous.firstMessageId,
        );
  return {
    sessionId,
    firstMessageId,
    firstItemIndex:
      prependedCount > 0
        ? previous.firstItemIndex - prependedCount
        : previous.firstItemIndex,
  };
}

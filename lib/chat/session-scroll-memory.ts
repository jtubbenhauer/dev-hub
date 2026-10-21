import type { FlatIndexLocationWithAlign } from "react-virtuoso";
import { isNearBottom } from "@/lib/chat/scroll-position";

export type ChatScrollPosition =
  | { isAtBottom: true }
  | { isAtBottom: false; messageId: string; offsetPx: number };

export interface ScrollAnchorMessage {
  info: { id: string };
}

const MAX_REMEMBERED_SESSIONS = 200;

// Module-level so positions survive the Virtuoso remount on session switch.
const scrollPositionsBySession = new Map<string, ChatScrollPosition>();

export function rememberChatScrollPosition(
  sessionKey: string,
  position: ChatScrollPosition,
): void {
  // Re-insert so Map iteration order tracks recency for eviction.
  scrollPositionsBySession.delete(sessionKey);
  scrollPositionsBySession.set(sessionKey, position);
  if (scrollPositionsBySession.size > MAX_REMEMBERED_SESSIONS) {
    const oldestKey = scrollPositionsBySession.keys().next().value;
    if (oldestKey !== undefined) scrollPositionsBySession.delete(oldestKey);
  }
}

export function getRememberedChatScrollPosition(
  sessionKey: string,
): ChatScrollPosition | undefined {
  return scrollPositionsBySession.get(sessionKey);
}

export function readChatScrollPosition(
  scroller: HTMLElement,
  messages: ReadonlyArray<ScrollAnchorMessage>,
): ChatScrollPosition | null {
  if (!scroller.isConnected) return null;
  if (
    isNearBottom({
      scrollTop: scroller.scrollTop,
      scrollHeight: scroller.scrollHeight,
      clientHeight: scroller.clientHeight,
    })
  ) {
    return { isAtBottom: true };
  }
  const viewportTop = scroller.getBoundingClientRect().top;
  const renderedItems = scroller.querySelectorAll<HTMLElement>(
    '[data-testid="virtuoso-item-list"] > [data-index]',
  );
  for (const item of renderedItems) {
    const itemRect = item.getBoundingClientRect();
    if (itemRect.bottom <= viewportTop) continue;
    const message = messages[Number(item.dataset.index)];
    if (!message) return null;
    return {
      isAtBottom: false,
      messageId: message.info.id,
      offsetPx: viewportTop - itemRect.top,
    };
  }
  return null;
}

export function resolveInitialScrollLocation(
  position: ChatScrollPosition | undefined,
  messages: ReadonlyArray<ScrollAnchorMessage>,
): FlatIndexLocationWithAlign | null {
  if (!position || position.isAtBottom) return null;
  const anchorIndex = messages.findIndex(
    (message) => message.info.id === position.messageId,
  );
  if (anchorIndex === -1) return null;
  return { index: anchorIndex, align: "start", offset: position.offsetPx };
}

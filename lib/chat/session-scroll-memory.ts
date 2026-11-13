import type { FlatIndexLocationWithAlign, SizeRange } from "react-virtuoso";
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

// Estimate for messages not yet measured in this tab. Most items are short
// tool-call rows and user bubbles; long replies get measured as they render.
export const DEFAULT_CHAT_ITEM_HEIGHT_PX = 120;

const MAX_REMEMBERED_HEIGHT_SESSIONS = 50;

// Keyed by message id so heights still line up after older pages are
// prepended or the session reopens with a different window loaded.
const itemHeightsBySession = new Map<string, Map<string, number>>();

export function rememberChatItemHeights(
  sessionKey: string,
  ranges: ReadonlyArray<SizeRange>,
  messages: ReadonlyArray<ScrollAnchorMessage>,
): void {
  const heights =
    itemHeightsBySession.get(sessionKey) ?? new Map<string, number>();
  for (const range of ranges) {
    if (range.size === DEFAULT_CHAT_ITEM_HEIGHT_PX) continue;
    const lastIndex = Math.min(range.endIndex, messages.length - 1);
    for (let index = range.startIndex; index <= lastIndex; index++) {
      heights.set(messages[index].info.id, range.size);
    }
  }
  itemHeightsBySession.delete(sessionKey);
  itemHeightsBySession.set(sessionKey, heights);
  if (itemHeightsBySession.size > MAX_REMEMBERED_HEIGHT_SESSIONS) {
    const oldestKey = itemHeightsBySession.keys().next().value;
    if (oldestKey !== undefined) itemHeightsBySession.delete(oldestKey);
  }
}

export function estimateChatItemHeights(
  sessionKey: string | null,
  messages: ReadonlyArray<ScrollAnchorMessage>,
): number[] {
  const heights = sessionKey ? itemHeightsBySession.get(sessionKey) : undefined;
  return messages.map(
    (message) => heights?.get(message.info.id) ?? DEFAULT_CHAT_ITEM_HEIGHT_PX,
  );
}

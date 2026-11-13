import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import type { VirtuosoHandle } from "react-virtuoso";
import {
  getRememberedChatScrollPosition,
  readChatScrollPosition,
  rememberChatItemHeights,
  rememberChatScrollPosition,
  resolveInitialScrollLocation,
  type ScrollAnchorMessage,
} from "@/lib/chat/session-scroll-memory";

export const CHAT_SCROLL_IDLE_MS = 150;

export function useChatScrollMemory(
  sessionKey: string | null,
  messages: ReadonlyArray<ScrollAnchorMessage>,
  virtuosoRef: RefObject<VirtuosoHandle | null>,
) {
  const [scrollerElement, setScrollerElement] = useState<HTMLElement | null>(
    null,
  );
  const messagesRef = useRef(messages);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // Frozen per session so scroll updates made while viewing it don't move the
  // list's initial location before Virtuoso has applied it.
  const rememberedPosition = useMemo(
    () =>
      sessionKey ? getRememberedChatScrollPosition(sessionKey) : undefined,
    [sessionKey],
  );
  const initialScrollLocation = resolveInitialScrollLocation(
    rememberedPosition,
    messages,
  );

  useEffect(() => {
    if (!scrollerElement || !sessionKey) return;
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    // Reading layout on every scroll frame competes with the list measuring
    // its items, so the position is recorded once scrolling settles.
    const recordScrollState = () => {
      idleTimer = null;
      if (!scrollerElement.isConnected) return;
      const position = readChatScrollPosition(
        scrollerElement,
        messagesRef.current,
      );
      if (position) rememberChatScrollPosition(sessionKey, position);
      virtuosoRef.current?.getState((snapshot) =>
        rememberChatItemHeights(
          sessionKey,
          snapshot.ranges,
          messagesRef.current,
        ),
      );
    };
    const handleScroll = () => {
      if (idleTimer !== null) clearTimeout(idleTimer);
      idleTimer = setTimeout(recordScrollState, CHAT_SCROLL_IDLE_MS);
    };
    scrollerElement.addEventListener("scroll", handleScroll, {
      passive: true,
    });
    return () => {
      scrollerElement.removeEventListener("scroll", handleScroll);
      if (idleTimer !== null) clearTimeout(idleTimer);
    };
  }, [scrollerElement, sessionKey, virtuosoRef]);

  const handleScrollerRef = useCallback(
    (element: HTMLElement | Window | null) => {
      setScrollerElement(element instanceof HTMLElement ? element : null);
    },
    [],
  );

  return { handleScrollerRef, initialScrollLocation };
}

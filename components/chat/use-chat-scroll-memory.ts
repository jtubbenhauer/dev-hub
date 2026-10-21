import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getRememberedChatScrollPosition,
  readChatScrollPosition,
  rememberChatScrollPosition,
  resolveInitialScrollLocation,
  type ScrollAnchorMessage,
} from "@/lib/chat/session-scroll-memory";

export function useChatScrollMemory(
  sessionKey: string | null,
  messages: ReadonlyArray<ScrollAnchorMessage>,
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
    let pendingFrame: number | null = null;
    const recordScrollPosition = () => {
      pendingFrame = null;
      const position = readChatScrollPosition(
        scrollerElement,
        messagesRef.current,
      );
      if (position) rememberChatScrollPosition(sessionKey, position);
    };
    const handleScroll = () => {
      if (pendingFrame !== null) return;
      pendingFrame = requestAnimationFrame(recordScrollPosition);
    };
    scrollerElement.addEventListener("scroll", handleScroll, {
      passive: true,
    });
    return () => {
      scrollerElement.removeEventListener("scroll", handleScroll);
      if (pendingFrame !== null) cancelAnimationFrame(pendingFrame);
    };
  }, [scrollerElement, sessionKey]);

  const handleScrollerRef = useCallback(
    (element: HTMLElement | Window | null) => {
      setScrollerElement(element instanceof HTMLElement ? element : null);
    },
    [],
  );

  return { handleScrollerRef, initialScrollLocation };
}

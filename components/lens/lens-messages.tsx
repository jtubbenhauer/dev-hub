"use client";

import { memo, useRef, useEffect, useCallback, useMemo } from "react";
import { ChatDisplayContext } from "@/components/chat/chat-display-context";
import { ChatMessage, isMessageVisible } from "@/components/chat/message";
import type { MessageWithParts } from "@/lib/opencode/types";
import type { StreamingStatus } from "@/stores/lens-store";

const LENS_DISPLAY_SETTINGS = {
  showThinking: true,
  showToolCalls: true,
  showTokens: false,
  showTimestamps: false,
};

interface LensMessagesProps {
  messages: MessageWithParts[];
  streamingStatus: StreamingStatus;
}

export const LensMessages = memo(function LensMessages({
  messages,
  streamingStatus,
}: LensMessagesProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);

  const visibleMessages = useMemo(
    () =>
      messages.filter((m) =>
        isMessageVisible(m, { showThinking: true, showToolCalls: true }),
      ),
    [messages],
  );

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, []);

  useEffect(() => {
    if (isAtBottomRef.current) {
      scrollToBottom();
    }
  }, [visibleMessages, scrollToBottom]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const threshold = 80;
    isAtBottomRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
  }, []);

  return (
    <ChatDisplayContext.Provider value={LENS_DISPLAY_SETTINGS}>
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto"
      >
        <div className="mx-auto max-w-3xl">
          {visibleMessages.map((msg, index) => {
            const prev = index > 0 ? visibleMessages[index - 1] : null;
            const showAvatar = !prev || prev.info.role !== msg.info.role;
            return (
              <ChatMessage
                key={msg.info.id}
                message={msg}
                showAvatar={showAvatar}
              />
            );
          })}

          {streamingStatus === "streaming" && <StreamingDots />}
        </div>
      </div>
    </ChatDisplayContext.Provider>
  );
});

function StreamingDots() {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className="flex gap-1">
        <span className="bg-muted-foreground/50 size-1.5 animate-bounce rounded-full [animation-delay:-0.3s]" />
        <span className="bg-muted-foreground/50 size-1.5 animate-bounce rounded-full [animation-delay:-0.15s]" />
        <span className="bg-muted-foreground/50 size-1.5 animate-bounce rounded-full" />
      </div>
      <span className="text-muted-foreground text-xs">Thinking...</span>
    </div>
  );
}

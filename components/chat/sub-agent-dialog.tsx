"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bot, Loader2, Send, Square } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ChatDisplayContext } from "@/components/chat/chat-display-context";
import { ChatMessage } from "@/components/chat/message";
import { TaskProgressPanel } from "@/components/chat/task-progress";
import { isNearBottom } from "@/lib/chat/scroll-position";
import { useSubAgentSession } from "@/components/chat/use-sub-agent-session";
import { formatRetryLabel } from "@/lib/chat/streaming-label";
import { useChatStore } from "@/stores/chat-store";

interface SubAgentDialogProps {
  childSessionId: string | null;
  workspaceId: string;
  description: string;
  isActive: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SubAgentDialog({
  childSessionId,
  workspaceId,
  description,
  isActive,
  open,
  onOpenChange,
}: SubAgentDialogProps) {
  const { messages, todos, sessionStatus } = useSubAgentSession({
    childSessionId,
    workspaceId,
    isOpen: open,
    isActive,
  });
  const scrollRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);
  const [now, setNow] = useState(Date.now);
  const [isNudging, setIsNudging] = useState(false);
  const [isAborting, setIsAborting] = useState(false);
  const [abortError, setAbortError] = useState<string | null>(null);
  const [hasAborted, setHasAborted] = useState(false);

  useEffect(() => {
    setHasAborted(false);
    setAbortError(null);
  }, [childSessionId]);

  useEffect(() => {
    if (sessionStatus?.type === "busy" || sessionStatus?.type === "retry") {
      setHasAborted(false);
    }
  }, [sessionStatus]);

  const isRetrying = sessionStatus?.type === "retry";
  useEffect(() => {
    if (!isRetrying) return;
    const interval = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(interval);
  }, [isRetrying]);

  const statusLabel = useMemo(() => {
    if (sessionStatus?.type === "retry") {
      return formatRetryLabel(sessionStatus, now);
    }
    if (!hasAborted && (sessionStatus?.type === "busy" || isActive)) {
      return "Working...";
    }
    return "Idle";
  }, [hasAborted, isActive, now, sessionStatus]);

  const statusAnnouncement = useMemo(() => {
    if (sessionStatus?.type === "retry") {
      const reason = sessionStatus.message.trim();
      return `Retrying, attempt ${sessionStatus.attempt}.${reason ? ` ${reason}` : ""}`;
    }
    if (!hasAborted && (sessionStatus?.type === "busy" || isActive)) {
      return "Sub-agent is working.";
    }
    return "Sub-agent is idle.";
  }, [hasAborted, isActive, sessionStatus]);

  const handleNudge = useCallback(async () => {
    if (!childSessionId || isNudging) return;
    setIsNudging(true);
    try {
      await useChatStore
        .getState()
        .sendMessage(childSessionId, "continue", workspaceId);
    } finally {
      setIsNudging(false);
    }
  }, [childSessionId, isNudging, workspaceId]);

  const handleAbort = useCallback(async () => {
    if (!childSessionId || isAborting) return;
    setIsAborting(true);
    setAbortError(null);
    const didAbort = await useChatStore
      .getState()
      .abortSession(childSessionId, workspaceId);
    if (!didAbort) {
      setAbortError("Could not abort this sub-agent. Try again.");
    } else {
      setHasAborted(true);
    }
    setIsAborting(false);
  }, [childSessionId, isAborting, workspaceId]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    isAtBottomRef.current = isNearBottom({
      scrollTop: el.scrollTop,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    });
  }, []);

  const scrollToBottom = useCallback(() => {
    if (!isAtBottomRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const visibleMessages = useMemo(
    () =>
      messages.filter((m) => {
        if (m.info.role === "user") return false;
        const hasText = m.parts.some(
          (p) =>
            p.type === "text" &&
            !("ignored" in p && p.ignored) &&
            "text" in p &&
            (p as { text: string }).text,
        );
        const hasTools = m.parts.some((p) => p.type === "tool");
        const hasReasoning = m.parts.some((p) => p.type === "reasoning");
        return hasText || hasTools || hasReasoning;
      }),
    [messages],
  );

  const model = useMemo(() => {
    const first = messages.find((m) => {
      if (m.info.role !== "assistant") return false;
      return m.info.modelID.length > 0 && m.info.providerID.length > 0;
    });
    if (!first) return null;
    const info = first.info;
    if (info.role !== "assistant") return null;
    return { modelID: info.modelID, providerID: info.providerID };
  }, [messages]);

  const displaySettings = useMemo(
    () => ({
      showThinking: true,
      showToolCalls: true,
      showTokens: false,
      showTimestamps: true,
    }),
    [],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl">
        <DialogHeader className="shrink-0 border-b px-6 py-4">
          <DialogTitle className="flex items-center gap-2 pr-6 text-sm">
            <Bot className="size-4 shrink-0 text-violet-500" />
            <span className="truncate">{description || "Sub-agent"}</span>
            {model && (
              <span
                title={`${model.providerID} / ${model.modelID}`}
                className="text-muted-foreground shrink-0 rounded border px-1.5 py-0.5 font-mono text-[10px] tracking-wide normal-case"
              >
                {model.modelID}
              </span>
            )}
            {isActive && !hasAborted && (
              <Loader2 className="size-3.5 shrink-0 animate-spin text-blue-500" />
            )}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Live output and controls for the selected sub-agent session.
          </DialogDescription>
        </DialogHeader>

        <ChatDisplayContext value={displaySettings}>
          <div className="flex min-h-0 flex-1 flex-col">
            {todos.length > 0 && (
              <div className="shrink-0 border-b px-6 py-3">
                <TaskProgressPanel
                  todos={todos}
                  listClassName="max-h-[min(40dvh,24rem)] overflow-y-auto overscroll-contain pr-2"
                />
              </div>
            )}

            <div
              ref={scrollRef}
              onScroll={handleScroll}
              className="flex-1 overflow-y-auto"
            >
              {!childSessionId ? (
                <div className="text-muted-foreground flex flex-col items-center justify-center gap-2 py-12">
                  <Bot className="size-5 opacity-40" />
                  <span className="text-sm">
                    Could not locate the sub-agent session.
                  </span>
                </div>
              ) : visibleMessages.length === 0 ? (
                <div className="text-muted-foreground flex flex-col items-center justify-center gap-2 py-12">
                  <Loader2 className="size-5 animate-spin" />
                  <span className="text-sm">
                    Waiting for sub-agent output...
                  </span>
                </div>
              ) : (
                <div>
                  {visibleMessages.map((msg, i) => {
                    const prev = i > 0 ? visibleMessages[i - 1] : null;
                    const showAvatar =
                      !prev || prev.info.role !== msg.info.role;
                    return (
                      <ChatMessage
                        key={msg.info.id}
                        message={msg}
                        showAvatar={showAvatar}
                      />
                    );
                  })}
                </div>
              )}
            </div>

            <div className="flex shrink-0 flex-col items-stretch gap-2 border-t px-4 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
              <div
                className="text-muted-foreground flex min-w-0 items-center gap-2 text-xs"
                aria-hidden="true"
              >
                {(sessionStatus?.type === "busy" || isRetrying) && (
                  <Loader2 className="size-3 shrink-0 animate-spin" />
                )}
                <span
                  className="break-words whitespace-normal sm:truncate"
                  title={statusLabel}
                >
                  {statusLabel}
                </span>
              </div>
              <span className="sr-only" role="status" aria-live="polite">
                {statusAnnouncement}
              </span>
              <div className="flex items-center justify-end gap-2">
                {abortError && (
                  <span className="text-destructive text-xs" role="alert">
                    {abortError}
                  </span>
                )}
                {!hasAborted &&
                  (sessionStatus?.type === "busy" ||
                    isRetrying ||
                    isActive) && (
                    <Button
                      type="button"
                      size="xs"
                      variant="destructive"
                      onClick={() => void handleAbort()}
                      disabled={!childSessionId || isAborting}
                      title="Abort this sub-agent"
                    >
                      {isAborting ? (
                        <Loader2 className="animate-spin" />
                      ) : (
                        <Square />
                      )}
                      {isAborting ? "Aborting" : "Abort"}
                    </Button>
                  )}
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  onClick={() => void handleNudge()}
                  disabled={!childSessionId || isNudging}
                  title='Send "continue" to this sub-agent'
                >
                  {isNudging ? <Loader2 className="animate-spin" /> : <Send />}
                  Nudge
                </Button>
              </div>
            </div>
          </div>
        </ChatDisplayContext>
      </DialogContent>
    </Dialog>
  );
}

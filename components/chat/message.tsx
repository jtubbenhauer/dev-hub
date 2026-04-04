"use client";

import { memo, useMemo, useState, useRef, useEffect, useCallback } from "react";
import {
  User,
  Bot,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Brain,
  Undo2,
  Copy,
  Check,
  Minimize2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useChatDisplay } from "@/components/chat/chat-display-context";
import { MarkdownContent } from "@/components/chat/markdown-content";
import { MessageToolUse } from "@/components/chat/message-tool-use";
import { parseCommentRefs } from "@/lib/comment-chat-bridge";
import { CommentRefBadge } from "@/components/chat/comment-ref-badge";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useWorkspaceGitHub } from "@/hooks/use-git";
import type { MessageWithParts } from "@/lib/opencode/types";
import type { ToolPart, TextPart, ReasoningPart } from "@/lib/opencode/types";

const THROTTLE_MS = 200;

function useThrottledValue<T>(value: T, delayMs: number): T {
  const [throttled, setThrottled] = useState(value);
  const lastUpdatedRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (value === throttled) return;

    const elapsed = Date.now() - lastUpdatedRef.current;
    const remaining = Math.max(0, delayMs - elapsed);

    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      lastUpdatedRef.current = Date.now();
      setThrottled(value);
    }, remaining);

    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [value, throttled, delayMs]);

  return throttled;
}

interface ChatMessageProps {
  message: MessageWithParts;
  showAvatar?: boolean;
  onRevert?: (messageId: string) => void;
}

export function isMessageVisible(
  message: MessageWithParts,
  options: { showThinking: boolean; showToolCalls: boolean },
): boolean {
  const { info, parts } = message;
  if (info.role === "user") {
    if (isSystemReminder(parts)) return false;
    return parts.some(
      (p) => p.type === "text" && "text" in p && !("ignored" in p && p.ignored),
    );
  }
  const hasText = parts.some(
    (p) =>
      p.type === "text" &&
      !("ignored" in p && p.ignored) &&
      "text" in p &&
      (p as { text: string }).text,
  );
  const hasThinking =
    options.showThinking && parts.some((p) => p.type === "reasoning");
  const hasTools =
    options.showToolCalls && parts.some((p) => p.type === "tool");
  const hasCompaction =
    parts.some((p) => p.type === "compaction") ||
    ("summary" in info && info.summary === true);
  const hasError = "error" in info && Boolean(info.error);
  return hasText || hasThinking || hasTools || hasCompaction || hasError;
}

function isSystemReminder(messageParts: readonly { type: string }[]): boolean {
  for (const p of messageParts) {
    if (p.type === "text" && "text" in p) {
      const text = (p as { text: string }).text;
      if (
        text.includes("<system-reminder>") ||
        text.includes("OMO_INTERNAL_INITIATOR")
      ) {
        return true;
      }
    }
  }
  return false;
}

function UserMessageBubble({
  textContent,
  workspaceId,
  owner,
  repo,
}: {
  textContent: string;
  workspaceId: string | null;
  owner?: string;
  repo?: string;
}) {
  const { refs, cleanedText } = parseCommentRefs(textContent);

  return (
    <>
      {refs.length > 0 && (
        <div className="flex flex-wrap justify-end gap-1 pb-1">
          {refs.map((r) => (
            <CommentRefBadge
              key={r.id}
              commentRef={r}
              workspaceId={workspaceId}
            />
          ))}
        </div>
      )}
      <div className="bg-primary text-primary-foreground rounded-2xl rounded-br-md px-4 py-2.5">
        <div className="user-bubble-prose prose prose-sm prose-p:my-1 prose-pre:my-1 prose-ol:my-1 prose-ul:my-1 prose-li:my-0.5 prose-headings:my-1.5 max-w-full overflow-hidden break-words">
          <MarkdownContent
            content={cleanedText || textContent}
            variant="bubble"
            owner={owner}
            repo={repo}
          />
        </div>
      </div>
    </>
  );
}

export const ChatMessage = memo(
  function ChatMessage({
    message,
    showAvatar = true,
    onRevert,
  }: ChatMessageProps) {
    const { info, parts } = message;
    const { showThinking, showToolCalls, showTokens, showTimestamps } =
      useChatDisplay();
    const isUser = info.role === "user";
    const isAssistant = info.role === "assistant";
    // Compaction summary messages have summary=true and/or agent="compaction" on the message info.
    // CompactionPart may live on a different message (the pre-compaction marker), so we detect
    // compaction from the message metadata, not the parts array.
    const isCompaction =
      isAssistant && "summary" in info && info.summary === true;
    const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
    const githubRepo = useWorkspaceGitHub(activeWorkspaceId);

    const { textContent, inlineThinkingParts } = useMemo(() => {
      const raw = parts
        .filter((p): p is TextPart => p.type === "text" && !p.ignored)
        .map((p) => p.text)
        .join("");

      const extracted: ReasoningPart[] = [];
      const thinkingRegex = /<thinking>([\s\S]*?)<\/thinking>/g;
      const masked = maskCodeContent(raw);
      let idx = 0;

      const thinkingSpans: {
        start: number;
        end: number;
        keepFrom: number | null;
      }[] = [];
      for (const match of masked.matchAll(thinkingRegex)) {
        const spanStart = match.index!;
        const spanEnd = spanStart + match[0].length;
        let content = raw
          .substring(spanStart, spanEnd)
          .replace(/^<thinking>\s?/, "")
          .replace(/\s?<\/thinking>$/, "")
          .trim();

        let keepFrom: number | null = null;
        if (content) {
          const fenceIdx = content.indexOf("```");
          if (fenceIdx >= 0) {
            keepFrom = fenceIdx;
            content = content.substring(0, fenceIdx).trim();
          }
          if (content) {
            extracted.push({
              id: `inline-thinking-${info.id}-${idx++}`,
              sessionID: info.sessionID,
              messageID: info.id,
              type: "reasoning",
              text: content,
              time: { start: info.time.created, end: info.time.created },
            });
          }
        }
        thinkingSpans.push({ start: spanStart, end: spanEnd, keepFrom });
      }

      let cleaned = raw;
      for (let i = thinkingSpans.length - 1; i >= 0; i--) {
        const span = thinkingSpans[i];
        const inner = raw
          .substring(span.start, span.end)
          .replace(/^<thinking>\s?/, "")
          .replace(/\s?<\/thinking>$/, "");
        const replacement =
          span.keepFrom != null ? inner.substring(span.keepFrom) : "";
        cleaned =
          cleaned.substring(0, span.start) +
          replacement +
          cleaned.substring(span.end);
      }
      cleaned = cleaned.trim();
      return {
        textContent: stripSoleCodeFence(cleaned),
        inlineThinkingParts: extracted,
      };
    }, [parts, info.id, info.sessionID, info.time.created]);

    const toolParts = useMemo(
      () => parts.filter((p): p is ToolPart => p.type === "tool"),
      [parts],
    );

    const { reasoningParts, reasoningOverflow } = useMemo(() => {
      const allReasoning = [
        ...parts.filter((p): p is ReasoningPart => p.type === "reasoning"),
        ...inlineThinkingParts,
      ].filter((p) => p.text || p.time.end == null);

      const trimmed: ReasoningPart[] = [];
      const overflow: string[] = [];
      for (const p of allReasoning) {
        const fenceIdx = p.text.indexOf("```");
        if (fenceIdx >= 0) {
          const before = p.text.substring(0, fenceIdx).trim();
          const after = p.text.substring(fenceIdx);
          if (before) {
            trimmed.push({ ...p, text: before });
          }
          overflow.push(after);
        } else {
          trimmed.push(p);
        }
      }
      return {
        reasoningParts: trimmed,
        reasoningOverflow: overflow.join("\n\n"),
      };
    }, [parts, inlineThinkingParts]);

    const compactionTextContent = useMemo(() => {
      if (!isCompaction) return "";
      // Compaction summaries may have text parts marked ignored — extract from ALL text parts
      return parts
        .filter((p): p is TextPart => p.type === "text")
        .map((p) => p.text)
        .join("")
        .replace(/<thinking>[\s\S]*?<\/thinking>\s*/g, "")
        .trim();
    }, [parts, isCompaction]);

    const fullTextContent = reasoningOverflow
      ? reasoningOverflow + (textContent ? "\n\n" + textContent : "")
      : textContent;

    const throttledTextContent = useThrottledValue(
      fullTextContent,
      THROTTLE_MS,
    );
    const hasError = isAssistant && "error" in info && info.error;

    return (
      <div
        className={cn(
          "group flex gap-3 px-4",
          showAvatar ? "py-4" : "py-1",
          isUser ? "justify-end" : "justify-start",
        )}
      >
        {!isUser &&
          (showAvatar ? (
            <div className="bg-primary/10 flex size-8 shrink-0 items-center justify-center rounded-full">
              <Bot className="text-primary size-4" />
            </div>
          ) : showTimestamps ? (
            <span className="text-muted-foreground/40 flex size-8 shrink-0 items-start justify-center pt-2 font-mono text-[9px] leading-tight">
              {formatMessageTime(info.time.created)}
            </span>
          ) : (
            <div className="size-8 shrink-0" />
          ))}

        <div
          className={cn(
            "flex flex-col gap-2",
            isUser
              ? "max-w-[80%] items-end"
              : "max-w-full min-w-0 items-start overflow-hidden md:max-w-[85%]",
          )}
        >
          {isUser ? (
            <>
              <div className="flex items-end gap-1">
                {onRevert && (
                  <button
                    type="button"
                    onClick={() => onRevert(info.id)}
                    className="text-muted-foreground/0 hover:bg-muted hover:text-muted-foreground group-hover:text-muted-foreground/60 mb-1 flex size-6 shrink-0 items-center justify-center rounded-md transition-colors"
                    title="Revert to before this message"
                  >
                    <Undo2 className="size-3.5" />
                  </button>
                )}
                <UserMessageBubble
                  textContent={textContent}
                  workspaceId={activeWorkspaceId}
                  owner={githubRepo?.owner}
                  repo={githubRepo?.repo}
                />
              </div>
            </>
          ) : (
            <div className="w-full min-w-0 space-y-3 overflow-hidden">
              {showThinking &&
                reasoningParts.map((part) => (
                  <ReasoningBlock key={part.id} part={part} />
                ))}

              {showToolCalls &&
                toolParts.map((part) => (
                  <MessageToolUse key={part.id} part={part} />
                ))}

              {isCompaction && compactionTextContent ? (
                <div className="bg-muted/20 rounded-lg border border-dashed">
                  <div className="flex items-center gap-2 px-3 py-2 text-sm">
                    <Minimize2 className="text-muted-foreground size-3.5 shrink-0" />
                    <span className="text-muted-foreground flex-1 text-xs font-medium">
                      Context compacted
                    </span>
                  </div>
                  <div className="border-t px-3 py-2">
                    <div className="group/markdown relative">
                      <CopyMarkdownButton content={compactionTextContent} />
                      <div className="prose prose-sm dark:prose-invert max-w-full overflow-hidden break-words">
                        <MarkdownContent
                          content={compactionTextContent}
                          owner={githubRepo?.owner}
                          repo={githubRepo?.repo}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              ) : isCompaction ? (
                <CompactionDivider />
              ) : throttledTextContent ? (
                <div className="group/markdown relative">
                  <CopyMarkdownButton content={fullTextContent} />
                  <div className="prose prose-sm dark:prose-invert max-w-full overflow-hidden break-words">
                    <MarkdownContent
                      content={throttledTextContent}
                      owner={githubRepo?.owner}
                      repo={githubRepo?.repo}
                    />
                  </div>
                </div>
              ) : null}

              {hasError && (
                <div className="border-destructive/50 bg-destructive/10 text-destructive flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
                  <AlertCircle className="size-4 shrink-0" />
                  <span>{getErrorMessage(info.error)}</span>
                </div>
              )}

              {showTokens && isAssistant && "tokens" in info && (
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-xs font-normal">
                    {info.tokens.input + info.tokens.output} tokens
                  </Badge>
                  {info.cost > 0 && (
                    <Badge variant="outline" className="text-xs font-normal">
                      ${info.cost.toFixed(4)}
                    </Badge>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {isUser &&
          (showAvatar ? (
            <div className="bg-muted flex size-8 shrink-0 items-center justify-center rounded-full">
              <User className="text-muted-foreground size-4" />
            </div>
          ) : showTimestamps ? (
            <span className="text-muted-foreground/40 mt-0.5 flex size-8 shrink-0 items-start justify-center font-mono text-[9px] leading-tight">
              {formatMessageTime(info.time.created)}
            </span>
          ) : (
            <div className="size-8 shrink-0" />
          ))}
      </div>
    );
  },
  (prev, next) =>
    prev.message.parts === next.message.parts &&
    prev.message.info === next.message.info &&
    prev.showAvatar === next.showAvatar &&
    prev.onRevert === next.onRevert,
);

const ReasoningBlock = memo(
  function ReasoningBlock({ part }: { part: ReasoningPart }) {
    const isThinking = part.time.end == null;
    const [isExpanded, setIsExpanded] = useState(true);

    const duration =
      part.time.end != null
        ? formatDuration(part.time.end - part.time.start)
        : null;

    return (
      <div
        className={cn(
          "rounded-lg border border-dashed",
          isThinking ? "border-amber-500/30 bg-amber-500/5" : "bg-muted/20",
        )}
      >
        <button
          type="button"
          onClick={() => setIsExpanded((prev) => !prev)}
          className="hover:bg-muted/30 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors"
        >
          {isThinking ? (
            <Brain className="size-3.5 shrink-0 animate-pulse text-amber-500" />
          ) : (
            <Brain className="text-muted-foreground size-3.5 shrink-0" />
          )}
          <span
            className={cn(
              "flex-1 text-xs font-medium",
              isThinking
                ? "text-amber-700 dark:text-amber-300"
                : "text-muted-foreground",
            )}
          >
            {isThinking
              ? "Thinking…"
              : `Thinking${duration ? ` · ${duration}` : ""}`}
          </span>
          {isExpanded ? (
            <ChevronDown className="text-muted-foreground size-3.5" />
          ) : (
            <ChevronRight className="text-muted-foreground size-3.5" />
          )}
        </button>
        <div
          className={cn(
            "grid transition-[grid-template-rows] duration-300 ease-in-out",
            isExpanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
          )}
        >
          <div className="overflow-hidden">
            <div className="border-t px-3 py-2">
              <p className="text-muted-foreground text-xs whitespace-pre-wrap italic">
                {part.text || (isThinking ? "…" : "")}
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  },
  (prev, next) =>
    prev.part.id === next.part.id &&
    prev.part.text === next.part.text &&
    prev.part.time === next.part.time,
);

function CopyMarkdownButton({ content }: { content: string }) {
  const [isCopied, setIsCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(content).then(() => {
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    });
  }, [content]);

  return (
    <Button
      size="icon-xs"
      variant="ghost"
      onClick={handleCopy}
      title="Copy markdown"
      className="absolute top-0 right-0 z-10 opacity-0 transition-opacity group-hover/markdown:opacity-100"
    >
      {isCopied ? <Check className="size-3" /> : <Copy className="size-3" />}
    </Button>
  );
}

function CompactionDivider() {
  return (
    <div className="flex items-center gap-2 py-1">
      <div className="border-muted-foreground/25 h-px flex-1 border-t border-dashed" />
      <span className="text-muted-foreground/40 text-[10px] font-medium tracking-wider uppercase">
        Context compacted
      </span>
      <div className="border-muted-foreground/25 h-px flex-1 border-t border-dashed" />
    </div>
  );
}

// Unwrap bare ``` fences that wrap the bulk of a response (not actual code)
export function stripSoleCodeFence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.endsWith("```")) return text;

  const fenceOpen = trimmed.indexOf("```");
  if (fenceOpen === -1) return text;

  const openLineEnd = trimmed.indexOf("\n", fenceOpen);
  if (openLineEnd === -1) return text;

  const openingLine = trimmed.slice(fenceOpen, openLineEnd).trim();
  if (openingLine !== "```") return text;

  const fenceClose = trimmed.lastIndexOf("```");
  if (fenceClose <= fenceOpen) return text;

  const inner = trimmed.slice(openLineEnd + 1, fenceClose).trimEnd();
  if (inner.includes("```")) return text;

  if (looksLikeCode(inner)) return text;

  const prefix = trimmed.slice(0, fenceOpen).trim();
  return prefix ? `${prefix}\n\n${inner}` : inner;
}

function looksLikeCode(text: string): boolean {
  const codeSignals = [
    /[{};]\s*$/m,
    /^\s*(import|export|const|let|var|function|class|def|return|if|for|while)\b/m,
    /^\s*(public|private|protected|static)\s/m,
    /=>/m,
    /\w+\.\w+\(.*\)\s*;?\s*$/m,
  ];
  const matches = codeSignals.filter((re) => re.test(text)).length;
  return matches >= 2;
}

export function maskCodeContent(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, (m) => "\0".repeat(m.length))
    .replace(/`[^`\n]+`/g, (m) => "\0".repeat(m.length));
}

function getErrorMessage(error: unknown): string {
  if (!error || typeof error !== "object") return "Unknown error";
  const typed = error as { data?: { message?: string }; name?: string };
  return typed.data?.message ?? typed.name ?? "Unknown error";
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  return `${minutes}m ${remainingSeconds}s`;
}

function formatMessageTime(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const isToday =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  const time = date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  if (isToday) return time;
  return `${date.toLocaleDateString([], { month: "short", day: "numeric" })} ${time}`;
}

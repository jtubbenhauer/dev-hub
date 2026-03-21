"use client"

import { memo, useMemo, useState, useRef, useEffect, useCallback } from "react"
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
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useChatDisplay } from "@/components/chat/chat-display-context"
import { MarkdownContent } from "@/components/chat/markdown-content"
import { MessageToolUse } from "@/components/chat/message-tool-use"
import { parseCommentRefs } from "@/lib/comment-chat-bridge"
import { CommentRefBadge } from "@/components/chat/comment-ref-badge"
import { useWorkspaceStore } from "@/stores/workspace-store"
import type { MessageWithParts } from "@/lib/opencode/types"
import type {
  ToolPart,
  TextPart,
  ReasoningPart,
} from "@/lib/opencode/types"

const THROTTLE_MS = 200

function useThrottledValue<T>(value: T, delayMs: number): T {
  const [throttled, setThrottled] = useState(value)
  const lastUpdatedRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (value === throttled) return

    const elapsed = Date.now() - lastUpdatedRef.current
    const remaining = Math.max(0, delayMs - elapsed)

    timerRef.current = setTimeout(() => {
      timerRef.current = null
      lastUpdatedRef.current = Date.now()
      setThrottled(value)
    }, remaining)

    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }
  }, [value, throttled, delayMs])

  return throttled
}

interface ChatMessageProps {
  message: MessageWithParts
  showAvatar?: boolean
  onRevert?: (messageId: string) => void
}

export function isMessageVisible(
  message: MessageWithParts,
  options: { showThinking: boolean; showToolCalls: boolean }
): boolean {
  const { info, parts } = message
  if (info.role === "user") {
    if (isSystemReminder(parts)) return false
    return parts.some((p) => p.type === "text" && "text" in p && !(("ignored" in p) && p.ignored))
  }
  const hasText = parts.some((p) => p.type === "text" && !("ignored" in p && p.ignored) && "text" in p && (p as { text: string }).text)
  const hasThinking = options.showThinking && parts.some((p) => p.type === "reasoning")
  const hasTools = options.showToolCalls && parts.some((p) => p.type === "tool")
  const hasCompaction = parts.some((p) => p.type === "compaction") || ("summary" in info && info.summary === true)
  const hasError = "error" in info && Boolean(info.error)
  return hasText || hasThinking || hasTools || hasCompaction || hasError
}

function isSystemReminder(messageParts: readonly { type: string }[]): boolean {
  for (const p of messageParts) {
    if (p.type === "text" && "text" in p) {
      const text = (p as { text: string }).text
      if (text.includes("<system-reminder>") || text.includes("OMO_INTERNAL_INITIATOR")) {
        return true
      }
    }
  }
  return false
}

function UserMessageBubble({ textContent, workspaceId }: { textContent: string; workspaceId: string | null }) {
  const { refs, cleanedText } = parseCommentRefs(textContent)

  return (
    <>
      {refs.length > 0 && (
        <div className="flex flex-wrap justify-end gap-1 pb-1">
          {refs.map((r) => (
            <CommentRefBadge key={r.id} commentRef={r} workspaceId={workspaceId} />
          ))}
        </div>
      )}
      <div className="rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-primary-foreground">
        <p className="whitespace-pre-wrap text-sm">{cleanedText || textContent}</p>
      </div>
    </>
  )
}

export const ChatMessage = memo(
  function ChatMessage({ message, showAvatar = true, onRevert }: ChatMessageProps) {
    const { info, parts } = message
  const { showThinking, showToolCalls, showTokens, showTimestamps } = useChatDisplay()
  const isUser = info.role === "user"
  const isAssistant = info.role === "assistant"
  // Compaction summary messages have summary=true and/or agent="compaction" on the message info.
  // CompactionPart may live on a different message (the pre-compaction marker), so we detect
  // compaction from the message metadata, not the parts array.
  const isCompaction = isAssistant && ("summary" in info && info.summary === true)
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId)

  const { textContent, inlineThinkingParts } = useMemo(() => {
    const raw = parts
      .filter((p): p is TextPart => p.type === "text" && !p.ignored)
      .map((p) => p.text)
      .join("")

    const extracted: ReasoningPart[] = []
    const thinkingRegex = /<thinking>([\s\S]*?)<\/thinking>/g
    let idx = 0
    for (const match of raw.matchAll(thinkingRegex)) {
      const content = match[1].trim()
      if (content) {
        extracted.push({
          id: `inline-thinking-${info.id}-${idx++}`,
          sessionID: info.sessionID,
          messageID: info.id,
          type: "reasoning",
          text: content,
          time: { start: info.time.created, end: info.time.created },
        })
      }
    }

    const cleaned = raw.replace(/<thinking>[\s\S]*?<\/thinking>\s*/g, "").trim()
    return { textContent: stripSoleCodeFence(cleaned), inlineThinkingParts: extracted }
  }, [parts, info.id, info.sessionID, info.time.created])

  const toolParts = useMemo(
    () => parts.filter((p): p is ToolPart => p.type === "tool"),
    [parts]
  )

  const reasoningParts = useMemo(
    () => [
      ...parts.filter((p): p is ReasoningPart => p.type === "reasoning"),
      ...inlineThinkingParts,
    ],
    [parts, inlineThinkingParts]
  )

  const compactionTextContent = useMemo(() => {
    if (!isCompaction) return ""
    // Compaction summaries may have text parts marked ignored — extract from ALL text parts
    return parts
      .filter((p): p is TextPart => p.type === "text")
      .map((p) => p.text)
      .join("")
      .replace(/<thinking>[\s\S]*?<\/thinking>\s*/g, "")
      .trim()
  }, [parts, isCompaction])

  // Throttle markdown re-parses during streaming (~200ms intervals)
  const throttledTextContent = useThrottledValue(textContent, THROTTLE_MS)
  const hasError = isAssistant && "error" in info && info.error

  return (
    <div
      className={cn(
        "group flex gap-3 px-4",
        showAvatar ? "py-4" : "py-1",
        isUser ? "justify-end" : "justify-start"
      )}
    >
      {!isUser && (
        showAvatar ? (
          <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10">
            <Bot className="size-4 text-primary" />
          </div>
        ) : (
          <div className="size-8 shrink-0" />
        )
      )}

        <div
          className={cn(
            "flex flex-col gap-2",
            isUser ? "max-w-[80%] items-end" : "min-w-0 max-w-full items-start overflow-hidden md:max-w-[85%]"
          )}
        >
        {isUser ? (
          <>
            <div className="flex items-end gap-1">
              {onRevert && (
                <button
                  type="button"
                  onClick={() => onRevert(info.id)}
                  className="mb-1 flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground/0 transition-colors hover:bg-muted hover:text-muted-foreground group-hover:text-muted-foreground/60"
                  title="Revert to before this message"
                >
                  <Undo2 className="size-3.5" />
                </button>
              )}
              <UserMessageBubble textContent={textContent} workspaceId={activeWorkspaceId} />
            </div>
            {showTimestamps && (
              <span className="text-[10px] text-muted-foreground/60">
                {formatMessageTime(info.time.created)}
              </span>
            )}
          </>
        ) : (
          <div className="min-w-0 w-full space-y-3 overflow-hidden">
            {showThinking && reasoningParts.map((part) => (
              <ReasoningBlock key={part.id} part={part} />
            ))}

            {showToolCalls && toolParts.map((part) => (
              <MessageToolUse key={part.id} part={part} />
            ))}

            {isCompaction && compactionTextContent ? (
              <div className="rounded-lg border border-dashed bg-muted/20">
                <div className="flex items-center gap-2 px-3 py-2 text-sm">
                  <Minimize2 className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="flex-1 text-xs font-medium text-muted-foreground">
                    Context compacted
                  </span>
                </div>
                <div className="border-t px-3 py-2">
                  <div className="group/markdown relative">
                    <CopyMarkdownButton content={compactionTextContent} />
                    <div className="prose prose-sm dark:prose-invert max-w-full overflow-hidden break-words">
                      <MarkdownContent content={compactionTextContent} />
                    </div>
                  </div>
                </div>
              </div>
            ) : isCompaction ? (
              <CompactionDivider />
            ) : throttledTextContent ? (
              <div className="group/markdown relative">
                <CopyMarkdownButton content={textContent} />
                <div className="prose prose-sm dark:prose-invert max-w-full overflow-hidden break-words">
                  <MarkdownContent content={throttledTextContent} />
                </div>
              </div>
            ) : null}

            {hasError && (
              <div className="flex items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                <AlertCircle className="size-4 shrink-0" />
                <span>{getErrorMessage(info.error)}</span>
              </div>
            )}

            {(showTokens || showTimestamps) && isAssistant && (
              <div className="flex items-center gap-2">
                {showTokens && "tokens" in info && (
                  <>
                    <Badge variant="outline" className="text-xs font-normal">
                      {info.tokens.input + info.tokens.output} tokens
                    </Badge>
                    {info.cost > 0 && (
                      <Badge variant="outline" className="text-xs font-normal">
                        ${info.cost.toFixed(4)}
                      </Badge>
                    )}
                  </>
                )}
                {showTimestamps && (
                  <span className="text-[10px] text-muted-foreground/60">
                    {formatMessageTime(info.time.created)}
                  </span>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {isUser && (
        showAvatar ? (
          <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted">
            <User className="size-4 text-muted-foreground" />
          </div>
        ) : (
          <div className="size-8 shrink-0" />
        )
      )}
    </div>
  )
},
(prev, next) =>
  prev.message.parts === next.message.parts &&
  prev.message.info === next.message.info &&
  prev.showAvatar === next.showAvatar &&
  prev.onRevert === next.onRevert
)

const ReasoningBlock = memo(function ReasoningBlock({ part }: { part: ReasoningPart }) {
  const isThinking = part.time.end == null
  const [isExpanded, setIsExpanded] = useState(true)

  const duration =
    part.time.end != null
      ? formatDuration(part.time.end - part.time.start)
      : null

  return (
    <div className={cn(
      "rounded-lg border border-dashed",
      isThinking ? "bg-amber-500/5 border-amber-500/30" : "bg-muted/20"
    )}>
      <button
        type="button"
        onClick={() => setIsExpanded((prev) => !prev)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/30 transition-colors rounded-lg"
      >
        {isThinking ? (
          <Brain className="size-3.5 shrink-0 text-amber-500 animate-pulse" />
        ) : (
          <Brain className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        <span className={cn(
          "flex-1 text-xs font-medium",
          isThinking ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground"
        )}>
          {isThinking ? "Thinking…" : `Thinking${duration ? ` · ${duration}` : ""}`}
        </span>
        {isExpanded ? (
          <ChevronDown className="size-3.5 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-3.5 text-muted-foreground" />
        )}
      </button>
      <div className={cn(
        "grid transition-[grid-template-rows] duration-300 ease-in-out",
        isExpanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
      )}>
        <div className="overflow-hidden">
          <div className="border-t px-3 py-2">
            <p className="whitespace-pre-wrap text-xs italic text-muted-foreground">
              {part.text || (isThinking ? "…" : "")}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
},
(prev, next) => prev.part.id === next.part.id && prev.part.text === next.part.text && prev.part.time === next.part.time
)

function CopyMarkdownButton({ content }: { content: string }) {
  const [isCopied, setIsCopied] = useState(false)

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(content).then(() => {
      setIsCopied(true)
      setTimeout(() => setIsCopied(false), 2000)
    })
  }, [content])

  return (
    <Button
      size="icon-xs"
      variant="ghost"
      onClick={handleCopy}
      title="Copy markdown"
      className="absolute right-0 top-0 z-10 opacity-0 transition-opacity group-hover/markdown:opacity-100"
    >
      {isCopied ? (
        <Check className="size-3" />
      ) : (
        <Copy className="size-3" />
      )}
    </Button>
  )
}

function CompactionDivider() {
  return (
    <div className="flex items-center gap-2 py-1">
      <div className="h-px flex-1 border-t border-dashed border-muted-foreground/25" />
      <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/40">
        Context compacted
      </span>
      <div className="h-px flex-1 border-t border-dashed border-muted-foreground/25" />
    </div>
  )
}



// Unwrap bare ``` fences that wrap the bulk of a response (not actual code)
export function stripSoleCodeFence(text: string): string {
  const trimmed = text.trim()
  if (!trimmed.endsWith("```")) return text

  const fenceOpen = trimmed.indexOf("```")
  if (fenceOpen === -1) return text

  const openLineEnd = trimmed.indexOf("\n", fenceOpen)
  if (openLineEnd === -1) return text

  const openingLine = trimmed.slice(fenceOpen, openLineEnd).trim()
  if (openingLine !== "```") return text

  const fenceClose = trimmed.lastIndexOf("```")
  if (fenceClose <= fenceOpen) return text

  const inner = trimmed.slice(openLineEnd + 1, fenceClose).trimEnd()
  if (inner.includes("```")) return text

  if (looksLikeCode(inner)) return text

  const prefix = trimmed.slice(0, fenceOpen).trim()
  return prefix ? `${prefix}\n\n${inner}` : inner
}

function looksLikeCode(text: string): boolean {
  const codeSignals = [
    /[{};]\s*$/m,
    /^\s*(import|export|const|let|var|function|class|def|return|if|for|while)\b/m,
    /^\s*(public|private|protected|static)\s/m,
    /=>/m,
    /\w+\.\w+\(.*\)\s*;?\s*$/m,
  ]
  const matches = codeSignals.filter((re) => re.test(text)).length
  return matches >= 2
}

function getErrorMessage(error: unknown): string {
  if (!error || typeof error !== "object") return "Unknown error"
  const typed = error as { data?: { message?: string }; name?: string }
  return typed.data?.message ?? typed.name ?? "Unknown error"
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const seconds = ms / 1000
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = Math.round(seconds % 60)
  return `${minutes}m ${remainingSeconds}s`
}

function formatMessageTime(timestamp: number): string {
  const date = new Date(timestamp)
  const now = new Date()
  const isToday =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  if (isToday) return time
  return `${date.toLocaleDateString([], { month: "short", day: "numeric" })} ${time}`
}

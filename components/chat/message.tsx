"use client"

import { memo, useMemo, useState, useCallback } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import rehypeHighlight from "rehype-highlight"
import {
  User,
  Bot,
  AlertCircle,
  Copy,
  Check,
  ChevronDown,
  ChevronRight,
  Brain,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useChatDisplay } from "@/components/chat/chat-display-context"
import { MessageToolUse } from "@/components/chat/message-tool-use"
import type { MessageWithParts } from "@/lib/opencode/types"
import type {
  ToolPart,
  TextPart,
  ReasoningPart,
} from "@/lib/opencode/types"

interface ChatMessageProps {
  message: MessageWithParts
  showAvatar?: boolean
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
  const hasCompaction = parts.some((p) => p.type === "compaction")
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

export const ChatMessage = memo(
  function ChatMessage({ message, showAvatar = true }: ChatMessageProps) {
    const { info, parts } = message
  const { showThinking, showToolCalls, showTokens } = useChatDisplay()
  const isUser = info.role === "user"
  const isAssistant = info.role === "assistant"

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
    return { textContent: cleaned, inlineThinkingParts: extracted }
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

  const compactionParts = useMemo(
    () => parts.filter((p) => p.type === "compaction"),
    [parts]
  )

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
          <div className="rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-primary-foreground">
            <p className="whitespace-pre-wrap text-sm">{textContent}</p>
          </div>
        ) : (
          <div className="min-w-0 w-full space-y-3 overflow-hidden">
            {showThinking && reasoningParts.map((part) => (
              <ReasoningBlock key={part.id} part={part} />
            ))}

            {showToolCalls && toolParts.map((part) => (
              <MessageToolUse key={part.id} part={part} />
            ))}

            {textContent && (
              <div className="prose prose-sm dark:prose-invert max-w-full overflow-hidden break-words">
                <MarkdownContent content={textContent} />
              </div>
            )}

            {compactionParts.length > 0 && <CompactionDivider />}

            {hasError && (
              <div className="flex items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
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
  prev.showAvatar === next.showAvatar
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

const MarkdownContent = memo(function MarkdownContent({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeHighlight]}
      components={{
        pre({ children, ...props }) {
          return (
            <div className="relative group/code overflow-x-auto">
              <CopyButton
                content={extractCodeFromPre(children)}
                className="absolute right-2 top-2"
              />
              <pre {...props}>{children}</pre>
            </div>
          )
        },
        table({ children, ...props }) {
          return (
            <div className="overflow-x-auto">
              <table {...props}>{children}</table>
            </div>
          )
        },
        code({ children, className, ...props }) {
          const isInline = !className
          if (isInline) {
            return (
              <code
                className="rounded bg-muted px-1.5 py-0.5 text-sm font-mono"
                {...props}
              >
                {children}
              </code>
            )
          }
          return (
            <code className={className} {...props}>
              {children}
            </code>
          )
        },
      }}
    >
      {content}
    </ReactMarkdown>
  )
})

function CopyButton({
  content,
  className,
}: {
  content: string
  className?: string
}) {
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
      className={cn(
        "opacity-0 transition-opacity group-hover/code:opacity-100",
        className
      )}
    >
      {isCopied ? (
        <Check className="size-3" />
      ) : (
        <Copy className="size-3" />
      )}
    </Button>
  )
}

function extractCodeFromPre(children: React.ReactNode): string {
  if (typeof children === "string") return children
  if (Array.isArray(children)) return children.map(extractCodeFromPre).join("")
  if (
    children &&
    typeof children === "object" &&
    "props" in children &&
    children.props
  ) {
    return extractCodeFromPre(
      (children.props as { children?: React.ReactNode }).children
    )
  }
  return ""
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

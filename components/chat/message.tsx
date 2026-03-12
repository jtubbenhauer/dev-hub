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
  GitBranch,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { MessageToolUse } from "@/components/chat/message-tool-use"
import type { MessageWithParts } from "@/lib/opencode/types"
import type {
  Part,
  ToolPart,
  TextPart,
  ReasoningPart,
} from "@/lib/opencode/types"

// Inline subtask type — not a named export in the SDK
type SubtaskPart = Extract<Part, { type: "subtask" }>

interface ChatMessageProps {
  message: MessageWithParts
}

export const ChatMessage = memo(
  function ChatMessage({ message }: ChatMessageProps) {
    const { info, parts } = message
  const isUser = info.role === "user"
  const isAssistant = info.role === "assistant"

  const textContent = useMemo(() => {
    return parts
      .filter((p): p is TextPart => p.type === "text" && !p.ignored)
      .map((p) => p.text)
      .join("")
  }, [parts])

  const toolParts = useMemo(
    () => parts.filter((p): p is ToolPart => p.type === "tool"),
    [parts]
  )

  const subtaskParts = useMemo(
    () => parts.filter((p): p is SubtaskPart => p.type === "subtask"),
    [parts]
  )

  const reasoningParts = useMemo(
    () => parts.filter((p): p is ReasoningPart => p.type === "reasoning"),
    [parts]
  )

  const compactionParts = useMemo(
    () => parts.filter((p) => p.type === "compaction"),
    [parts]
  )

  const hasError = isAssistant && "error" in info && info.error

  return (
    <div
      className={cn(
        "group flex gap-3 px-4 py-4",
        isUser ? "justify-end" : "justify-start"
      )}
    >
      {!isUser && (
        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10">
          <Bot className="size-4 text-primary" />
        </div>
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
            {reasoningParts.map((part) => (
              <ReasoningBlock key={part.id} part={part} />
            ))}

            {toolParts.map((part) => (
              <MessageToolUse key={part.id} part={part} />
            ))}

            {subtaskParts.map((part) => (
              <SubtaskCard key={part.id} part={part} />
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

            {isAssistant && "tokens" in info && (
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
        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted">
          <User className="size-4 text-muted-foreground" />
        </div>
      )}
    </div>
  )
},
(prev, next) =>
  prev.message.parts === next.message.parts &&
  prev.message.info === next.message.info
)

const ReasoningBlock = memo(function ReasoningBlock({ part }: { part: ReasoningPart }) {
  const [isExpanded, setIsExpanded] = useState(false)
  const duration =
    part.time.end != null
      ? formatDuration(part.time.end - part.time.start)
      : null

  return (
    <div className="rounded-lg border border-dashed bg-muted/20">
      <button
        onClick={() => setIsExpanded((prev) => !prev)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/30 transition-colors rounded-lg"
      >
        <Brain className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="flex-1 text-xs font-medium text-muted-foreground">
          Thinking{duration ? ` · ${duration}` : ""}
        </span>
        {isExpanded ? (
          <ChevronDown className="size-3.5 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-3.5 text-muted-foreground" />
        )}
      </button>
      {isExpanded && (
        <div className="border-t px-3 py-2">
          <p className="whitespace-pre-wrap text-xs italic text-muted-foreground">
            {part.text}
          </p>
        </div>
      )}
    </div>
  )
},
(prev, next) => prev.part.id === next.part.id && prev.part.text === next.part.text && prev.part.time === next.part.time
)

const SubtaskCard = memo(function SubtaskCard({ part }: { part: SubtaskPart }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-violet-500/30 bg-violet-500/5 px-3 py-2 overflow-hidden">
      <GitBranch className="mt-0.5 size-3.5 shrink-0 text-violet-500" />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-violet-700 dark:text-violet-300 truncate">
          Subagent · {part.agent}
        </p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {part.description || part.prompt}
        </p>
      </div>
    </div>
  )
})

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

"use client"

import { useMemo } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import rehypeHighlight from "rehype-highlight"
import { User, Bot, AlertCircle, Copy, Check } from "lucide-react"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { MessageToolUse } from "@/components/chat/message-tool-use"
import { useState, useCallback } from "react"
import type { MessageWithParts } from "@/lib/opencode/types"
import type { Part, ToolPart, TextPart } from "@/lib/opencode/types"

interface ChatMessageProps {
  message: MessageWithParts
}

export function ChatMessage({ message }: ChatMessageProps) {
  const { info, parts } = message
  const isUser = info.role === "user"
  const isAssistant = info.role === "assistant"

  const textContent = useMemo(() => {
    return parts
      .filter((p): p is TextPart => p.type === "text" && !p.ignored)
      .map((p) => p.text)
      .join("")
  }, [parts])

  const toolParts = useMemo(() => {
    return parts.filter((p): p is ToolPart => p.type === "tool")
  }, [parts])

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
          isUser ? "max-w-[80%] items-end" : "max-w-[85%] items-start"
        )}
      >
        {isUser ? (
          <div className="rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-primary-foreground">
            <p className="whitespace-pre-wrap text-sm">{textContent}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {toolParts.map((part) => (
              <MessageToolUse key={part.id} part={part} />
            ))}

            {textContent && (
              <div className="prose prose-sm dark:prose-invert max-w-none">
                <MarkdownContent content={textContent} />
              </div>
            )}

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
}

function MarkdownContent({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeHighlight]}
      components={{
        pre({ children, ...props }) {
          return (
            <div className="relative group/code">
              <CopyButton
                content={extractCodeFromPre(children)}
                className="absolute right-2 top-2"
              />
              <pre {...props}>{children}</pre>
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
}

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

function getErrorMessage(
  error: unknown
): string {
  if (!error || typeof error !== "object") return "Unknown error"
  const typed = error as { data?: { message?: string }; name?: string }
  return typed.data?.message ?? typed.name ?? "Unknown error"
}

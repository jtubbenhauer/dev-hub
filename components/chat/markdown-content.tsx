"use client"

import { memo, useState, useCallback } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import remarkBreaks from "remark-breaks"
import rehypeHighlight from "rehype-highlight"
import { Copy, Check } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { isCodePath, FilePathCode } from "@/components/chat/file-path-code"

export const MarkdownContent = memo(function MarkdownContent({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkBreaks]}
      rehypePlugins={[rehypeHighlight]}
      components={{
        pre({ children, ...props }) {
          return (
            <div className="overflow-x-auto">
              <pre {...props} className={cn(props.className, "relative group/code")}>
                <CopyButton
                  content={extractCodeFromPre(children)}
                  className="absolute right-2 top-2 z-10"
                />
                {children}
              </pre>
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
            const text = typeof children === "string" ? children : String(children ?? "")
            if (isCodePath(text)) {
              return <FilePathCode text={text}>{children}</FilePathCode>
            }
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

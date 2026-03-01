"use client"

import { useEffect, useRef, useMemo } from "react"
import AnsiToHtml from "ansi-to-html"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"

const converter = new AnsiToHtml({
  fg: "hsl(var(--foreground))",
  bg: "transparent",
  newline: true,
  escapeXML: true,
})

interface CommandOutputProps {
  lines: string[]
  isRunning: boolean
  className?: string
}

export function CommandOutput({ lines, isRunning, className }: CommandOutputProps) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [lines])

  const html = useMemo(() => {
    const combined = lines.join("")
    return converter.toHtml(combined)
  }, [lines])

  if (lines.length === 0 && !isRunning) return null

  return (
    <ScrollArea className={cn("rounded-md border bg-black/90", className)}>
      <div className="relative p-3">
        <pre
          className="font-mono text-xs leading-relaxed text-white/90"
          // Safe: ansi-to-html escapes XML by default via escapeXML: true
          dangerouslySetInnerHTML={{ __html: html }}
        />
        {isRunning && (
          <span className="animate-pulse font-mono text-xs text-white/50">▋</span>
        )}
        <div ref={bottomRef} />
      </div>
    </ScrollArea>
  )
}

"use client"

import { useState, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface CommitPanelProps {
  stagedCount: number
  onCommit: (message: string) => void
  isCommitting: boolean
}

export function CommitPanel({ stagedCount, onCommit, isCommitting }: CommitPanelProps) {
  const [message, setMessage] = useState("")

  const handleCommit = useCallback(() => {
    const trimmed = message.trim()
    if (!trimmed || stagedCount === 0) return
    onCommit(trimmed)
    setMessage("")
  }, [message, stagedCount, onCommit])

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        handleCommit()
      }
    },
    [handleCommit]
  )

  return (
    <div className="shrink-0 space-y-2 border-t p-2">
      <textarea
        value={message}
        onChange={(event) => setMessage(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Commit message..."
        rows={3}
        className={cn(
          "w-full resize-none rounded-md border bg-muted/50 px-3 py-2 text-sm",
          "placeholder:text-muted-foreground",
          "focus:outline-none focus:ring-2 focus:ring-ring"
        )}
      />
      <Button
        onClick={handleCommit}
        disabled={!message.trim() || stagedCount === 0 || isCommitting}
        className="w-full"
        size="sm"
      >
        {isCommitting
          ? "Committing..."
          : `Commit (${stagedCount} file${stagedCount !== 1 ? "s" : ""})`}
      </Button>
    </div>
  )
}

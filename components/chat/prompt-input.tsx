"use client"

import { useState, useRef, useCallback } from "react"
import { Send, Square } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface PromptInputProps {
  onSubmit: (text: string) => void
  onAbort: () => void
  isStreaming: boolean
  disabled?: boolean
}

export function PromptInput({
  onSubmit,
  onAbort,
  isStreaming,
  disabled,
}: PromptInputProps) {
  const [value, setValue] = useState("")
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const handleSubmit = useCallback(() => {
    const trimmed = value.trim()
    if (!trimmed || disabled) return
    onSubmit(trimmed)
    setValue("")
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto"
    }
  }, [value, disabled, onSubmit])

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault()
        if (isStreaming) return
        handleSubmit()
      }
    },
    [handleSubmit, isStreaming]
  )

  const handleInput = useCallback(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.style.height = "auto"
    textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`
  }, [])

  return (
    <div className="shrink-0 border-t bg-background p-4">
      <div className="relative flex items-end gap-2">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(event) => {
            setValue(event.target.value)
            handleInput()
          }}
          onKeyDown={handleKeyDown}
          placeholder="Send a message..."
          disabled={disabled}
          rows={1}
          className={cn(
            "flex-1 resize-none rounded-lg border bg-muted/50 px-4 py-3 text-sm",
            "placeholder:text-muted-foreground",
            "focus:outline-none focus:ring-2 focus:ring-ring",
            "disabled:cursor-not-allowed disabled:opacity-50",
            "max-h-[200px]"
          )}
        />
        {isStreaming ? (
          <Button
            size="icon"
            variant="destructive"
            onClick={onAbort}
            className="shrink-0"
          >
            <Square className="size-4" />
          </Button>
        ) : (
          <Button
            size="icon"
            onClick={handleSubmit}
            disabled={!value.trim() || disabled}
            className="shrink-0"
          >
            <Send className="size-4" />
          </Button>
        )}
      </div>
    </div>
  )
}

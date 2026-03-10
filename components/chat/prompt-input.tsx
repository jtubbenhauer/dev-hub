"use client"

import { useState, useRef, useCallback, forwardRef, useImperativeHandle } from "react"
import { Send, Square, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { FilePicker } from "@/components/chat/file-picker"
import { cn } from "@/lib/utils"

export interface PromptInputHandle {
  focus: () => void
}

interface PromptInputProps {
  onSubmit: (text: string) => void
  onAbort: () => void
  isStreaming: boolean
  disabled?: boolean
  workspaceId: string | null
}

export const PromptInput = forwardRef<PromptInputHandle, PromptInputProps>(function PromptInput({
  onSubmit,
  onAbort,
  isStreaming,
  disabled,
  workspaceId,
}, ref) {
  const [value, setValue] = useState("")
  const [selectedFiles, setSelectedFiles] = useState<string[]>([])
  const [pickerQuery, setPickerQuery] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useImperativeHandle(ref, () => ({
    focus: () => textareaRef.current?.focus(),
  }), [])

  const autoResize = useCallback(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.style.height = "auto"
    textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`
  }, [])

  const handleSubmit = useCallback(() => {
    const trimmed = value.trim()
    if (!trimmed || disabled) return
    const fileContext =
      selectedFiles.length > 0
        ? `Context files: ${selectedFiles.join(", ")}\n\n`
        : ""
    onSubmit(fileContext + trimmed)
    setValue("")
    setSelectedFiles([])
    setPickerQuery(null)
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto"
    }
  }, [value, disabled, selectedFiles, onSubmit])

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = e.target.value
      setValue(newValue)
      autoResize()

      // Detect @ trigger and track the query after it
      const cursor = e.target.selectionStart ?? newValue.length
      const textUpToCursor = newValue.slice(0, cursor)
      const atIndex = textUpToCursor.lastIndexOf("@")

      if (atIndex !== -1) {
        const queryAfterAt = textUpToCursor.slice(atIndex + 1)
        // Only open picker if there's no space in the query (spaces close it)
        if (!queryAfterAt.includes(" ")) {
          setPickerQuery(queryAfterAt)
          return
        }
      }
      setPickerQuery(null)
    },
    [autoResize]
  )

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === "Escape" && pickerQuery !== null) {
        event.preventDefault()
        setPickerQuery(null)
        return
      }
      // Let FilePicker intercept ArrowUp/ArrowDown/Enter when picker is open
      if (
        pickerQuery !== null &&
        (event.key === "ArrowUp" || event.key === "ArrowDown" || event.key === "Enter")
      ) {
        event.preventDefault()
        return
      }
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault()
        if (isStreaming) return
        handleSubmit()
      }
    },
    [handleSubmit, isStreaming, pickerQuery]
  )

  const handleFileSelect = useCallback(
    (path: string) => {
      // Remove the @query fragment from the textarea value
      const cursor = textareaRef.current?.selectionStart ?? value.length
      const textUpToCursor = value.slice(0, cursor)
      const atIndex = textUpToCursor.lastIndexOf("@")
      const before = atIndex !== -1 ? value.slice(0, atIndex) : value
      const after = value.slice(cursor)
      setValue(before + after)

      setSelectedFiles((prev) =>
        prev.includes(path) ? prev : [...prev, path]
      )
      setPickerQuery(null)

      // Restore focus
      requestAnimationFrame(() => {
        textareaRef.current?.focus()
        autoResize()
      })
    },
    [value, autoResize]
  )

  const handleRemoveFile = useCallback((path: string) => {
    setSelectedFiles((prev) => prev.filter((p) => p !== path))
  }, [])

  const handleFocus = useCallback(() => {
    // Delay to let the keyboard animation finish before scrolling
    setTimeout(() => {
      textareaRef.current?.scrollIntoView({ block: "end", behavior: "smooth" })
    }, 300)
  }, [])

  const isPickerOpen = pickerQuery !== null && !!workspaceId

  return (
    <div className="shrink-0 border-t bg-background p-4">
      {/* Selected file chips */}
      {selectedFiles.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {selectedFiles.map((path) => {
            const fileName = path.split("/").pop() ?? path
            return (
              <span
                key={path}
                className="flex items-center gap-1 rounded-md border bg-muted px-2 py-0.5 text-xs"
              >
                <span className="text-muted-foreground">@</span>
                {fileName}
                <button
                  onClick={() => handleRemoveFile(path)}
                  className="ml-0.5 text-muted-foreground hover:text-foreground"
                >
                  <X className="size-3" />
                </button>
              </span>
            )
          })}
        </div>
      )}

      <div className="relative flex items-end gap-2">
        {/* File picker popover */}
        {isPickerOpen && (
          <FilePicker
            workspaceId={workspaceId}
            query={pickerQuery}
            onSelect={handleFileSelect}
            onClose={() => setPickerQuery(null)}
          />
        )}

        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={handleFocus}
          placeholder="Send a message... (type @ to reference files)"
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
})

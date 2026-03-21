"use client"

import { useState, useRef, useCallback, forwardRef, useImperativeHandle, useEffect } from "react"
import { Send, Square, X, MessageSquare } from "lucide-react"
import { Button } from "@/components/ui/button"
import { FilePicker } from "@/components/chat/file-picker"
import { CommandPicker, type SlashCommand } from "@/components/chat/command-picker"
import { cn } from "@/lib/utils"
import type { Command } from "@/lib/opencode/types"
import { getPendingCommentChips, clearPendingCommentChips, getAllCachedComments, type CommentChip } from "@/lib/comment-chat-bridge"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

export interface PromptInputHandle {
  focus: () => void
  setValue: (text: string) => void
}

type SessionDraft = {
  text: string
  commentChips: CommentChip[]
  files: string[]
}

const sessionDrafts = new Map<string, SessionDraft>()

interface PromptInputProps {
  onSubmit: (text: string) => void
  onAbort: () => void
  isStreaming: boolean
  disabled?: boolean
  workspaceId: string | null
  sessionId: string | null
  commands: Command[]
  onCommandSelect: (command: SlashCommand, args: string) => void
}

export const PromptInput = forwardRef<PromptInputHandle, PromptInputProps>(function PromptInput({
  onSubmit,
  onAbort,
  isStreaming,
  disabled,
  workspaceId,
  sessionId,
  commands,
  onCommandSelect,
}, ref) {
  const queryClient = useQueryClient()
  const [value, setValue] = useState(() => {
    const draft = sessionId ? sessionDrafts.get(sessionId) : undefined
    return draft?.text ?? ""
  })
  const [selectedFiles, setSelectedFiles] = useState<string[]>(() => {
    const draft = sessionId ? sessionDrafts.get(sessionId) : undefined
    return draft?.files ?? []
  })
  const [selectedComments, setSelectedComments] = useState<CommentChip[]>(() => {
    const draft = sessionId ? sessionDrafts.get(sessionId) : undefined
    return draft?.commentChips ?? []
  })
  const [pickerQuery, setPickerQuery] = useState<string | null>(null)
  const [commandQuery, setCommandQuery] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [prevSessionId, setPrevSessionId] = useState(sessionId)

  if (prevSessionId !== sessionId) {
    if (prevSessionId) {
      sessionDrafts.set(prevSessionId, {
        text: value,
        commentChips: selectedComments,
        files: selectedFiles,
      })
    }
    setPrevSessionId(sessionId)
    const draft = sessionId ? sessionDrafts.get(sessionId) : undefined
    setValue(draft?.text ?? "")
    setSelectedComments(draft?.commentChips ?? [])
    setSelectedFiles(draft?.files ?? [])
  }

  useEffect(() => {
    // Resize textarea after session switch restores text
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.style.height = "auto"
    textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`
  }, [value])

  useEffect(() => {
    if (!sessionId) return
    const hasContent = value || selectedComments.length > 0 || selectedFiles.length > 0
    if (hasContent) {
      sessionDrafts.set(sessionId, { text: value, commentChips: selectedComments, files: selectedFiles })
    } else {
      sessionDrafts.delete(sessionId)
    }
  }, [sessionId, value, selectedComments, selectedFiles])

  useImperativeHandle(ref, () => ({
    focus: () => textareaRef.current?.focus(),
    setValue: (text: string) => {
      setValue(text)
      requestAnimationFrame(() => {
        const textarea = textareaRef.current
        if (!textarea) return
        textarea.style.height = "auto"
        textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`
        textarea.focus()
      })
    },
  }), [])

  // Pick up any pending comment chips on mount and when the workspace changes
  const [prevWorkspaceId, setPrevWorkspaceId] = useState<string | null>(null)
  if (prevWorkspaceId !== workspaceId) {
    setPrevWorkspaceId(workspaceId)
    if (workspaceId) {
      const chips = getPendingCommentChips(workspaceId)
      if (chips.length > 0) {
        setSelectedComments(chips)
        clearPendingCommentChips(workspaceId)
      }
    }
  }

  useEffect(() => {
    if (!workspaceId) return

    const handleAttach = () => {
      if (!workspaceId) return
      const incoming = getPendingCommentChips(workspaceId)
      if (incoming.length > 0) {
        setSelectedComments((prev) => {
          const existingIds = new Set(prev.map((c) => c.id))
          const newChips = incoming.filter((c) => !existingIds.has(c.id))
          return newChips.length > 0 ? [...prev, ...newChips] : prev
        })
        clearPendingCommentChips(workspaceId)
      }
    }

    const handleDetach = (e: Event) => {
      const { commentId } = (e as CustomEvent).detail as { commentId: number }
      setSelectedComments((prev) => prev.filter((c) => c.id !== commentId))
    }

    const handleUpdate = (e: Event) => {
      const { commentId, body } = (e as CustomEvent).detail as { commentId: number; body: string }
      setSelectedComments((prev) =>
        prev.map((c) => (c.id === commentId ? { ...c, body } : c))
      )
    }

    window.addEventListener("attach-comment-to-chat", handleAttach)
    window.addEventListener("detach-comment-from-chat", handleDetach)
    window.addEventListener("update-comment-in-chat", handleUpdate)
    return () => {
      window.removeEventListener("attach-comment-to-chat", handleAttach)
      window.removeEventListener("detach-comment-from-chat", handleDetach)
      window.removeEventListener("update-comment-in-chat", handleUpdate)
    }
  }, [workspaceId])

  const autoResize = useCallback(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.style.height = "auto"
    textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`
  }, [])


  const availableCommands = useCallback((): SlashCommand[] => {
    const builtins: SlashCommand[] = [
      { name: "compact", description: "Summarize conversation to save context", source: "builtin" },
      { name: "undo", description: "Revert last assistant message changes", source: "builtin" },
    ]
    const serverCommands = commands.map((command) => ({
      name: command.name,
      description: command.description,
      source: "server" as const,
    }))
    return [...builtins, ...serverCommands]
  }, [commands])

  const handleSubmit = useCallback(() => {
    const trimmed = value.trim()
    if (!trimmed || disabled) return

    if (trimmed.startsWith("/")) {
      const withoutSlash = trimmed.slice(1)
      const spaceIndex = withoutSlash.indexOf(" ")
      const commandName = spaceIndex === -1 ? withoutSlash : withoutSlash.slice(0, spaceIndex)
      const args = spaceIndex === -1 ? "" : withoutSlash.slice(spaceIndex + 1)
      const match = availableCommands().find((cmd) => cmd.name === commandName)
      if (match) {
        onCommandSelect(match, args)
        setValue("")
        setSelectedFiles([])
        setSelectedComments([])
        setPickerQuery(null)
        setCommandQuery(null)
        if (textareaRef.current) {
          textareaRef.current.style.height = "auto"
        }
        return
      }
    }

    if (selectedComments.length > 0 && workspaceId) {
      const allComments = getAllCachedComments(queryClient, workspaceId)
      if (allComments.length > 0) {
        const commentMap = new Map(allComments.map((c) => [c.id, c]))
        const stale = selectedComments.filter((c) => {
          const live = commentMap.get(c.id)
          return live?.resolved === true || !live
        })
        if (stale.length > 0) {
          toast.warning(`${stale.length} attached comment(s) have been resolved or deleted since you added them`)
        }
      }
    }

    const commentContext =
      selectedComments.length > 0
        ? `Comment references:\n${selectedComments
            .map((c) => {
              const lineRef =
                c.startLine === c.endLine
                  ? `${c.filePath}:${c.startLine}`
                  : `${c.filePath}:${c.startLine}-${c.endLine}`
              return `- [comment:${c.id}] ${lineRef} — "${c.body}"`
            })
            .join("\n")}\n\n`
        : ""
    const fileContext =
      selectedFiles.length > 0
        ? `Context files: ${selectedFiles.join(", ")}\n\n`
        : ""
    onSubmit(commentContext + fileContext + trimmed)
    setValue("")
    setSelectedFiles([])
    setSelectedComments([])
    setPickerQuery(null)
    setCommandQuery(null)
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto"
    }
  }, [value, disabled, selectedFiles, selectedComments, onSubmit, availableCommands, onCommandSelect, queryClient, workspaceId])

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

      if (newValue.startsWith("/")) {
        const firstSpace = newValue.indexOf(" ")
        const isInCommand = firstSpace === -1 || cursor <= firstSpace
        if (isInCommand) {
          const queryEnd = firstSpace === -1 ? cursor : Math.min(cursor, firstSpace)
          const queryAfterSlash = newValue.slice(1, queryEnd)
          setCommandQuery(queryAfterSlash)
          return
        }
      }

      setCommandQuery(null)
    },
    [autoResize]
  )

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === "Escape" && (pickerQuery !== null || commandQuery !== null)) {
        event.preventDefault()
        setPickerQuery(null)
        setCommandQuery(null)
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
      if (
        commandQuery !== null &&
        (event.key === "ArrowUp" || event.key === "ArrowDown" || event.key === "Enter")
      ) {
        event.preventDefault()
        return
      }
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault()
        handleSubmit()
      }
    },
    [handleSubmit, pickerQuery, commandQuery]
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

  const handleRemoveComment = useCallback((id: number) => {
    setSelectedComments((prev) => prev.filter((c) => c.id !== id))
  }, [])

  const handleCommandSelect = useCallback((cmd: SlashCommand) => {
    setValue(`/${cmd.name} `)
    setCommandQuery(null)
    requestAnimationFrame(() => textareaRef.current?.focus())
  }, [])

  const handleFocus = useCallback(() => {
    // Delay to let the keyboard animation finish before scrolling
    setTimeout(() => {
      textareaRef.current?.scrollIntoView({ block: "end", behavior: "smooth" })
    }, 300)
  }, [])

  const isPickerOpen = pickerQuery !== null && !!workspaceId
  const isCommandPickerOpen = commandQuery !== null

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

      {/* Comment context chips */}
      {selectedComments.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {selectedComments.map((comment) => {
            const fileName = comment.filePath.split("/").pop() ?? comment.filePath
            const lineLabel =
              comment.startLine === comment.endLine
                ? `${fileName}:${comment.startLine}`
                : `${fileName}:${comment.startLine}-${comment.endLine}`
            return (
              <span
                key={comment.id}
                className="flex items-center gap-1 rounded-md border bg-primary/10 px-2 py-0.5 text-xs"
              >
                <MessageSquare className="size-3 text-primary" />
                {lineLabel}
                <button
                  onClick={() => handleRemoveComment(comment.id)}
                  aria-label={`Remove comment ${fileName}:${comment.startLine}`}
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

        {isCommandPickerOpen && (
          <CommandPicker
            commands={commands}
            query={commandQuery ?? ""}
            onSelect={handleCommandSelect}
            onClose={() => setCommandQuery(null)}
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
        {isStreaming && (
          <Button
            size={null}
            variant="destructive"
            onClick={onAbort}
            className="shrink-0 h-auto w-[46px] rounded-lg border border-transparent px-0 py-3.5"
          >
            <Square className="size-4" />
          </Button>
        )}
        <Button
          size={null}
          onClick={handleSubmit}
          disabled={!value.trim() || disabled}
          className="shrink-0 h-auto w-[46px] rounded-lg border border-transparent px-0 py-3.5"
        >
          <Send className="size-4" />
        </Button>
      </div>
    </div>
  )
})

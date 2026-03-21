"use client"

import { useState, useEffect, useRef, useCallback, useMemo } from "react"
import { Loader2, Bot } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ChatDisplayContext } from "@/components/chat/chat-display-context"
import { ChatMessage } from "@/components/chat/message"
import { TaskProgressPanel } from "@/components/chat/task-progress"
import type { MessageWithParts, Part, Message, Todo } from "@/lib/opencode/types"

interface SubAgentDialogProps {
  childSessionId: string
  workspaceId: string
  description: string
  isActive: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
}

function buildProxyUrl(
  path: string,
  workspaceId?: string,
): string {
  const params = new URLSearchParams()
  if (workspaceId) params.set("workspaceId", workspaceId)
  const query = params.toString()
  return `/api/opencode/${path}${query ? `?${query}` : ""}`
}

export function SubAgentDialog({
  childSessionId,
  workspaceId,
  description,
  isActive,
  open,
  onOpenChange,
}: SubAgentDialogProps) {
  const [messages, setMessages] = useState<MessageWithParts[]>([])
  const [todos, setTodos] = useState<Todo[]>([])
  const scrollRef = useRef<HTMLDivElement>(null)
  const eventSourceRef = useRef<EventSource | null>(null)
  const hasFetchedRef = useRef(false)

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight
    })
  }, [])

  const fetchMessages = useCallback(async () => {
    try {
      const res = await fetch(
        buildProxyUrl(`session/${childSessionId}/message`, workspaceId)
      )
      if (!res.ok) return
      const data: MessageWithParts[] = await res.json()
      setMessages(data)
      scrollToBottom()
    } catch {
      /* noop */
    }
  }, [childSessionId, workspaceId, scrollToBottom])

  useEffect(() => {
    if (!open || !childSessionId || !workspaceId) return
    if (hasFetchedRef.current) return
    hasFetchedRef.current = true

    fetch(buildProxyUrl(`session/${childSessionId}/message`, workspaceId))
      .then((res) => res.ok ? res.json() as Promise<MessageWithParts[]> : Promise.resolve(null))
      .then((data) => {
        if (data) {
          setMessages(data)
          scrollToBottom()
        }
      })
      .catch(() => { /* noop */ })
  }, [open, childSessionId, workspaceId, scrollToBottom])

  useEffect(() => {
    if (!open) {
      hasFetchedRef.current = false
    }
  }, [open])

  useEffect(() => {
    if (!open || !childSessionId || !workspaceId) return

    const url = `/api/opencode/events?workspaceIds=${workspaceId}`
    const es = new EventSource(url)
    eventSourceRef.current = es

    es.onopen = () => {
      fetchMessages()
    }

    es.onmessage = (evt) => {
      try {
        const { event } = JSON.parse(evt.data) as {
          workspaceId: string
          event: Record<string, unknown>
        }
        const eventType = event.type as string
        const properties = event.properties as Record<string, unknown> | undefined
        if (!properties) return

        switch (eventType) {
          case "message.updated": {
            const info = properties.info as Message
            if (!info || info.sessionID !== childSessionId) return

            setMessages((prev) => {
              const idx = prev.findIndex((m) => m.info.id === info.id)
              if (idx >= 0) {
                return prev.map((m, i) => (i === idx ? { ...m, info } : m))
              }
              return [...prev, { info, parts: [] }]
            })
            scrollToBottom()
            break
          }

          case "message.part.updated": {
            const part = properties.part as Part
            if (!part || part.sessionID !== childSessionId) return

            setMessages((prev) => {
              const msgIdx = prev.findIndex((m) => m.info.id === part.messageID)
              if (msgIdx < 0) {
                const placeholder: Message = {
                  id: part.messageID,
                  sessionID: part.sessionID,
                  role: "assistant",
                  time: { created: Date.now() },
                  parentID: "",
                  modelID: "",
                  providerID: "",
                  mode: "",
                  path: { cwd: "", root: "" },
                  cost: 0,
                  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
                }
                return [...prev, { info: placeholder, parts: [part] }]
              }

              const msg = prev[msgIdx]
              const partIdx = msg.parts.findIndex((p) => p.id === part.id)
              const updatedParts =
                partIdx >= 0
                  ? msg.parts.map((p, i) => (i === partIdx ? part : p))
                  : [...msg.parts, part]

              return prev.map((m, i) =>
                i === msgIdx ? { ...m, parts: updatedParts } : m
              )
            })
            scrollToBottom()
            break
          }

          case "message.part.removed": {
            const sessionID = properties.sessionID as string
            const messageID = properties.messageID as string
            const partID = properties.partID as string
            if (sessionID !== childSessionId) return

            setMessages((prev) =>
              prev.map((m) =>
                m.info.id === messageID
                  ? { ...m, parts: m.parts.filter((p) => p.id !== partID) }
                  : m
              )
            )
            break
          }

          case "message.removed": {
            const sessionID = properties.sessionID as string
            const messageID = properties.messageID as string
            if (sessionID !== childSessionId) return
            setMessages((prev) => prev.filter((m) => m.info.id !== messageID))
            break
          }

          case "todo.updated": {
            const sessionID = properties.sessionID as string
            if (sessionID !== childSessionId) return
            setTodos(properties.todos as Todo[])
            break
          }

          case "session.idle": {
            const sessionID = properties.sessionID as string
            if (sessionID !== childSessionId) return
            fetchMessages()
            break
          }
        }
      } catch {
        /* noop */
      }
    }

    es.onerror = () => {
      es.close()
    }

    return () => {
      es.close()
      eventSourceRef.current = null
    }
  }, [open, childSessionId, workspaceId, fetchMessages, scrollToBottom])

  const visibleMessages = useMemo(
    () =>
      messages.filter((m) => {
        if (m.info.role === "user") return false
        const hasText = m.parts.some(
          (p) => p.type === "text" && !("ignored" in p && p.ignored) && "text" in p && (p as { text: string }).text
        )
        const hasTools = m.parts.some((p) => p.type === "tool")
        const hasReasoning = m.parts.some((p) => p.type === "reasoning")
        return hasText || hasTools || hasReasoning
      }),
    [messages]
  )

  const displaySettings = useMemo(
    () => ({ showThinking: true, showToolCalls: true, showTokens: false, showTimestamps: false }),
    []
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-5xl max-h-[85vh] flex flex-col gap-0 p-0 overflow-hidden">
        <DialogHeader className="shrink-0 px-6 py-4 border-b">
          <DialogTitle className="flex items-center gap-2 text-sm pr-6">
            <Bot className="size-4 text-violet-500 shrink-0" />
            <span className="truncate">{description || "Sub-agent"}</span>
            {isActive && (
              <Loader2 className="size-3.5 animate-spin text-blue-500 shrink-0" />
            )}
          </DialogTitle>
        </DialogHeader>

        <ChatDisplayContext value={displaySettings}>
          <div className="flex-1 min-h-0 flex flex-col">
            {todos.length > 0 && (
              <div className="shrink-0 border-b px-6 py-3">
                <TaskProgressPanel todos={todos} />
              </div>
            )}

            <div
              ref={scrollRef}
              className="flex-1 overflow-y-auto"
            >
              {visibleMessages.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 py-12 text-muted-foreground">
                  <Loader2 className="size-5 animate-spin" />
                  <span className="text-sm">Waiting for sub-agent output...</span>
                </div>
              ) : (
                <div>
                  {visibleMessages.map((msg, i) => {
                    const prev = i > 0 ? visibleMessages[i - 1] : null
                    const showAvatar = !prev || prev.info.role !== msg.info.role
                    return (
                      <ChatMessage
                        key={msg.info.id}
                        message={msg}
                        showAvatar={showAvatar}
                      />
                    )
                  })}
                </div>
              )}

              {isActive && visibleMessages.length > 0 && (
                <div className="flex items-center gap-2 px-4 py-3 text-xs text-muted-foreground">
                  <Loader2 className="size-3 animate-spin" />
                  Working...
                </div>
              )}
            </div>
          </div>
        </ChatDisplayContext>
      </DialogContent>
    </Dialog>
  )
}

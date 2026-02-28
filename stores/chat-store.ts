import { create } from "zustand"
import type {
  Session,
  Message,
  Part,
  Permission,
  Todo,
  SessionStatus,
  MessageWithParts,
} from "@/lib/opencode/types"

type StreamingStatus = "idle" | "connecting" | "streaming" | "error"

interface ChatState {
  sessions: Record<string, Session>
  activeSessionId: string | null
  activeWorkspaceId: string | null

  messages: Record<string, MessageWithParts[]>
  streamingStatus: StreamingStatus
  streamingError: string | null

  sessionStatus: SessionStatus | null
  permissions: Permission[]
  todos: Todo[]

  eventSource: EventSource | null
  sseReconnectAttempts: number

  setActiveSession: (sessionId: string | null) => void
  setActiveWorkspaceId: (workspaceId: string | null) => void

  fetchSessions: (workspaceId: string) => Promise<void>
  createSession: (workspaceId: string) => Promise<Session | null>
  deleteSession: (sessionId: string, workspaceId: string) => Promise<void>
  fetchMessages: (sessionId: string, workspaceId: string) => Promise<void>

  sendMessage: (
    sessionId: string,
    text: string,
    workspaceId: string,
    model?: { providerID: string; modelID: string },
    agent?: string
  ) => Promise<void>
  abortSession: (sessionId: string, workspaceId: string) => Promise<void>
  respondToPermission: (
    sessionId: string,
    permissionId: string,
    response: string,
    workspaceId: string
  ) => Promise<void>

  connectSSE: (workspaceId: string) => void
  disconnectSSE: () => void
  refreshActiveSessionStatus: (workspaceId: string) => Promise<void>

  handleEvent: (event: Record<string, unknown>) => void
  clearChat: () => void
}

function buildProxyUrl(
  path: string,
  workspaceId?: string,
  extraParams?: Record<string, string>
): string {
  const params = new URLSearchParams()
  if (workspaceId) params.set("workspaceId", workspaceId)
  if (extraParams) {
    for (const [key, value] of Object.entries(extraParams)) {
      params.set(key, value)
    }
  }
  const query = params.toString()
  return `/api/opencode/${path}${query ? `?${query}` : ""}`
}

export const useChatStore = create<ChatState>()((set, get) => ({
  sessions: {},
  activeSessionId: null,
  activeWorkspaceId: null,

  messages: {},
  streamingStatus: "idle",
  streamingError: null,

  sessionStatus: null,
  permissions: [],
  todos: [],

  eventSource: null,
  sseReconnectAttempts: 0,

  setActiveSession: (sessionId) => set({ activeSessionId: sessionId }),
  setActiveWorkspaceId: (workspaceId) => {
    const current = get().activeWorkspaceId
    if (current === workspaceId) return
    set({
      activeWorkspaceId: workspaceId,
      activeSessionId: null,
      sessions: {},
      messages: {},
      permissions: [],
      todos: [],
      sseReconnectAttempts: 0,
    })
  },

  fetchSessions: async (workspaceId) => {
    try {
      const response = await fetch(buildProxyUrl("session", workspaceId))
      if (!response.ok) {
        console.warn(`[chat] fetchSessions failed: ${response.status}`)
        return
      }

      const data: Session[] = await response.json()
      const sessionsMap: Record<string, Session> = {}
      for (const session of data) {
        sessionsMap[session.id] = session
      }
      set({ sessions: sessionsMap })
    } catch (error) {
      console.warn("[chat] fetchSessions error:", error)
    }
  },

  createSession: async (workspaceId) => {
    try {
      const response = await fetch(buildProxyUrl("session", workspaceId), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      })
      if (!response.ok) return null

      const session: Session = await response.json()
      set((state) => ({
        sessions: { ...state.sessions, [session.id]: session },
        activeSessionId: session.id,
      }))
      return session
    } catch {
      return null
    }
  },

  deleteSession: async (sessionId, workspaceId) => {
    try {
      await fetch(buildProxyUrl(`session/${sessionId}`, workspaceId), {
        method: "DELETE",
      })
      set((state) => {
        const { [sessionId]: _, ...remainingSessions } = state.sessions
        const { [sessionId]: __, ...remainingMessages } = state.messages
        return {
          sessions: remainingSessions,
          messages: remainingMessages,
          activeSessionId:
            state.activeSessionId === sessionId
              ? null
              : state.activeSessionId,
        }
      })
    } catch {
      // Silently fail
    }
  },

  fetchMessages: async (sessionId, workspaceId) => {
    try {
      const response = await fetch(
        buildProxyUrl(`session/${sessionId}/message`, workspaceId)
      )
      if (!response.ok) return

      const data: MessageWithParts[] = await response.json()
      set((state) => ({
        messages: { ...state.messages, [sessionId]: data },
      }))
    } catch {
      // Silently fail
    }
  },

  sendMessage: async (sessionId, text, workspaceId, model, agent) => {
    set({ streamingStatus: "streaming", streamingError: null })

    try {
      const body: Record<string, unknown> = {
        parts: [{ type: "text", text }],
      }
      if (model) body.model = model
      if (agent) body.agent = agent

      const response = await fetch(
        buildProxyUrl(`session/${sessionId}/prompt_async`, workspaceId),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }
      )

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: "Failed to send message" }))
        set({
          streamingStatus: "error",
          streamingError: error.error || error.detail || "Failed to send message",
        })
        return
      }
      // 204 response means accepted — events come via SSE
      set({ streamingError: null })
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to send message"
      set({ streamingStatus: "error", streamingError: message })
    }
  },

  abortSession: async (sessionId, workspaceId) => {
    try {
      await fetch(
        buildProxyUrl(`session/${sessionId}/abort`, workspaceId),
        { method: "POST" }
      )
      set({ streamingStatus: "idle" })
    } catch {
      // Best effort
    }
  },

  respondToPermission: async (
    sessionId,
    permissionId,
    response,
    workspaceId
  ) => {
    try {
      await fetch(
        buildProxyUrl(
          `session/${sessionId}/permissions/${permissionId}`,
          workspaceId
        ),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ response }),
        }
      )
      set((state) => ({
        permissions: state.permissions.filter((p) => p.id !== permissionId),
      }))
    } catch {
      // Best effort
    }
  },

  connectSSE: (workspaceId) => {
    const existing = get().eventSource
    if (existing) {
      existing.close()
    }

    const url = buildProxyUrl("event", workspaceId)
    const eventSource = new EventSource(url)

    eventSource.onopen = () => {
      console.log("[chat] SSE connected")
      const state = get()
      set({
        sseReconnectAttempts: 0,
        streamingError: null,
        // If status was stuck on "error" from a previous SSE disconnect, reset to idle
        streamingStatus: state.streamingStatus === "error" ? "idle" : state.streamingStatus,
      })

      // Re-fetch active session's messages to catch anything missed during disconnect
      const { activeSessionId, activeWorkspaceId } = get()
      if (activeSessionId && activeWorkspaceId) {
        get().fetchMessages(activeSessionId, activeWorkspaceId)
        // Re-fetch session info to check if it transitioned to idle while disconnected
        get().refreshActiveSessionStatus(activeWorkspaceId)
      }
    }

    eventSource.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data) as Record<string, unknown>
        get().handleEvent(parsed)
      } catch {
        // Ignore malformed events
      }
    }

    eventSource.onerror = () => {
      eventSource.close()

      const attempts = get().sseReconnectAttempts
      const MAX_RECONNECT_ATTEMPTS = 20
      const backoffMs = Math.min(1000 * 2 ** Math.min(attempts, 5), 30000)

      if (attempts >= MAX_RECONNECT_ATTEMPTS) {
        console.error("[chat] SSE reconnect limit reached, giving up")
        set({
          streamingStatus: "error",
          streamingError: "Lost connection to OpenCode server",
          eventSource: null,
        })
        return
      }

      set({ sseReconnectAttempts: attempts + 1 })

      setTimeout(() => {
        const current = get().activeWorkspaceId
        if (current === workspaceId) {
          get().connectSSE(workspaceId)
        }
      }, backoffMs)
    }

    set({ eventSource })
  },

  disconnectSSE: () => {
    const existing = get().eventSource
    if (existing) {
      existing.close()
    }
    set({ eventSource: null })
  },

  refreshActiveSessionStatus: async (workspaceId) => {
    const { activeSessionId, streamingStatus } = get()
    if (!activeSessionId || streamingStatus === "idle") return

    try {
      const response = await fetch(
        buildProxyUrl("session/status", workspaceId)
      )
      if (!response.ok) return

      const statusMap = (await response.json()) as Record<string, SessionStatus>
      const status = statusMap[activeSessionId]
      if (status && status.type === "idle") {
        set({ streamingStatus: "idle", sessionStatus: status })
      } else if (status) {
        set({ sessionStatus: status })
      }
    } catch {
      // Best effort — SSE events will catch up
    }
  },

  handleEvent: (event) => {
    const eventType = event.type as string
    const properties = event.properties as Record<string, unknown> | undefined

    if (!properties) return

    switch (eventType) {
      case "message.updated": {
        const info = properties.info as Message
        if (!info) return
        set((state) => {
          const sessionId = info.sessionID
          const sessionMessages = state.messages[sessionId] ?? []
          const existingIndex = sessionMessages.findIndex(
            (m) => m.info.id === info.id
          )
          const updated =
            existingIndex >= 0
              ? sessionMessages.map((m, i) =>
                  i === existingIndex ? { ...m, info } : m
                )
              : [...sessionMessages, { info, parts: [] }]
          return { messages: { ...state.messages, [sessionId]: updated } }
        })
        break
      }

      case "message.removed": {
        const sessionID = properties.sessionID as string
        const messageID = properties.messageID as string
        set((state) => {
          const sessionMessages = state.messages[sessionID] ?? []
          return {
            messages: {
              ...state.messages,
              [sessionID]: sessionMessages.filter(
                (m) => m.info.id !== messageID
              ),
            },
          }
        })
        break
      }

      case "message.part.updated": {
        const part = properties.part as Part
        if (!part) return
        set((state) => {
          const sessionMessages = state.messages[part.sessionID] ?? []
          const messageIndex = sessionMessages.findIndex(
            (m) => m.info.id === part.messageID
          )
          if (messageIndex < 0) return state

          const message = sessionMessages[messageIndex]
          const partIndex = message.parts.findIndex((p) => p.id === part.id)
          const updatedParts =
            partIndex >= 0
              ? message.parts.map((p, i) => (i === partIndex ? part : p))
              : [...message.parts, part]

          const updatedMessages = sessionMessages.map((m, i) =>
            i === messageIndex ? { ...m, parts: updatedParts } : m
          )
          return {
            messages: {
              ...state.messages,
              [part.sessionID]: updatedMessages,
            },
          }
        })
        break
      }

      case "message.part.removed": {
        const sessionID = properties.sessionID as string
        const messageID = properties.messageID as string
        const partID = properties.partID as string
        set((state) => {
          const sessionMessages = state.messages[sessionID] ?? []
          return {
            messages: {
              ...state.messages,
              [sessionID]: sessionMessages.map((m) =>
                m.info.id === messageID
                  ? { ...m, parts: m.parts.filter((p) => p.id !== partID) }
                  : m
              ),
            },
          }
        })
        break
      }

      case "session.created":
      case "session.updated": {
        const info = properties.info as Session
        if (!info) return
        set((state) => ({
          sessions: { ...state.sessions, [info.id]: info },
        }))
        break
      }

      case "session.deleted": {
        const info = properties.info as Session
        if (!info) return
        set((state) => {
          const { [info.id]: _, ...remaining } = state.sessions
          return {
            sessions: remaining,
            activeSessionId:
              state.activeSessionId === info.id
                ? null
                : state.activeSessionId,
          }
        })
        break
      }

      case "session.status": {
        const sessionID = properties.sessionID as string
        const status = properties.status as SessionStatus
        const activeId = get().activeSessionId
        if (sessionID === activeId) {
          const isIdle = status.type === "idle"
          set({
            sessionStatus: status,
            streamingStatus: isIdle ? "idle" : "streaming",
          })
        }
        break
      }

      case "session.idle": {
        const sessionID = properties.sessionID as string
        const activeId = get().activeSessionId
        if (sessionID === activeId) {
          set({
            sessionStatus: { type: "idle" },
            streamingStatus: "idle",
          })
        }
        break
      }

      case "session.error": {
        const sessionID = properties.sessionID as string | undefined
        const activeId = get().activeSessionId
        if (!sessionID || sessionID === activeId) {
          const errorObj = properties.error as
            | { data?: { message?: string } }
            | undefined
          set({
            streamingStatus: "error",
            streamingError: errorObj?.data?.message ?? "Session error",
          })
        }
        break
      }

      case "permission.updated": {
        const permission = properties as unknown as Permission
        set((state) => ({
          permissions: [...state.permissions, permission],
        }))
        break
      }

      case "permission.replied": {
        const permissionID = properties.permissionID as string
        set((state) => ({
          permissions: state.permissions.filter(
            (p) => p.id !== permissionID
          ),
        }))
        break
      }

      case "todo.updated": {
        const todos = properties.todos as Todo[]
        const sessionID = properties.sessionID as string
        const activeId = get().activeSessionId
        if (sessionID === activeId) {
          set({ todos })
        }
        break
      }
    }
  },

  clearChat: () =>
    set({
      activeSessionId: null,
      messages: {},
      streamingStatus: "idle",
      streamingError: null,
      sessionStatus: null,
      permissions: [],
      todos: [],
      sseReconnectAttempts: 0,
    }),
}))

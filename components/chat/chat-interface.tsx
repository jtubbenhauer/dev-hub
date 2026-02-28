"use client"

import { useEffect, useRef, useCallback, useState } from "react"
import { Loader2, AlertCircle, ShieldAlert, Check, X } from "lucide-react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useChatStore } from "@/stores/chat-store"
import { useWorkspaceStore } from "@/stores/workspace-store"
import { ChatMessage } from "@/components/chat/message"
import { PromptInput } from "@/components/chat/prompt-input"
import { SessionList } from "@/components/chat/session-list"
import { ModelSelector } from "@/components/chat/model-selector"
import { AgentSelector } from "@/components/chat/agent-selector"
import type { Permission } from "@/lib/opencode/types"

interface SelectedModel {
  providerID: string
  modelID: string
}

export function ChatInterface() {
  const [selectedModel, setSelectedModel] = useState<SelectedModel | null>(null)
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null)
  const [isSessionListOpen, setIsSessionListOpen] = useState(true)
  const scrollAreaRef = useRef<HTMLDivElement>(null)

  const activeWorkspaceId = useWorkspaceStore(
    (state) => state.activeWorkspaceId
  )
  const {
    sessions,
    activeSessionId,
    messages,
    streamingStatus,
    streamingError,
    permissions,
    setActiveSession,
    setActiveWorkspaceId,
    fetchSessions,
    createSession,
    deleteSession,
    fetchMessages,
    sendMessage,
    abortSession,
    respondToPermission,
    connectSSE,
    disconnectSSE,
  } = useChatStore()

  // Sync workspace from global workspace store
  useEffect(() => {
    setActiveWorkspaceId(activeWorkspaceId)
  }, [activeWorkspaceId, setActiveWorkspaceId])

  // Fetch sessions + connect SSE when workspace changes
  useEffect(() => {
    if (!activeWorkspaceId) return
    fetchSessions(activeWorkspaceId)
    connectSSE(activeWorkspaceId)
    return () => disconnectSSE()
  }, [activeWorkspaceId, fetchSessions, connectSSE, disconnectSSE])

  // Fetch messages when active session changes
  useEffect(() => {
    if (!activeSessionId || !activeWorkspaceId) return
    fetchMessages(activeSessionId, activeWorkspaceId)
  }, [activeSessionId, activeWorkspaceId, fetchMessages])

  // Auto-scroll to bottom on new messages
  const activeMessages = activeSessionId ? messages[activeSessionId] ?? [] : []
  useEffect(() => {
    const viewport = scrollAreaRef.current?.querySelector("[data-slot='scroll-area-viewport']")
    if (viewport) {
      viewport.scrollTop = viewport.scrollHeight
    }
  }, [activeMessages])

  const handleSendMessage = useCallback(
    async (text: string) => {
      if (!activeWorkspaceId) return

      let sessionId = activeSessionId
      if (!sessionId) {
        const newSession = await createSession(activeWorkspaceId)
        if (!newSession) return
        sessionId = newSession.id
      }

      sendMessage(sessionId, text, activeWorkspaceId, selectedModel ?? undefined, selectedAgent ?? undefined)
    },
    [
      activeWorkspaceId,
      activeSessionId,
      selectedModel,
      selectedAgent,
      createSession,
      sendMessage,
    ]
  )

  const handleAbort = useCallback(() => {
    if (!activeSessionId || !activeWorkspaceId) return
    abortSession(activeSessionId, activeWorkspaceId)
  }, [activeSessionId, activeWorkspaceId, abortSession])

  const handleCreateSession = useCallback(() => {
    if (!activeWorkspaceId) return
    createSession(activeWorkspaceId)
  }, [activeWorkspaceId, createSession])

  const handleDeleteSession = useCallback(
    (sessionId: string) => {
      if (!activeWorkspaceId) return
      deleteSession(sessionId, activeWorkspaceId)
    },
    [activeWorkspaceId, deleteSession]
  )

  const handleSelectSession = useCallback(
    (sessionId: string) => {
      setActiveSession(sessionId)
    },
    [setActiveSession]
  )

  const activePermissions = permissions.filter(
    (p) => p.sessionID === activeSessionId
  )

  if (!activeWorkspaceId) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <AlertCircle className="size-12 text-muted-foreground/50" />
        <h3 className="text-lg font-medium">No workspace selected</h3>
        <p className="max-w-md text-sm text-muted-foreground">
          Select a workspace from the sidebar to start chatting with OpenCode.
        </p>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0">
      {/* Session sidebar — hidden on mobile by default */}
      {isSessionListOpen && (
        <div className="hidden w-60 shrink-0 md:block">
          <SessionList
            sessions={sessions}
            activeSessionId={activeSessionId}
            onSelectSession={handleSelectSession}
            onCreateSession={handleCreateSession}
            onDeleteSession={handleDeleteSession}
          />
        </div>
      )}

      {/* Main chat area */}
      <div className="flex min-h-0 flex-1 flex-col">
        {/* Chat toolbar */}
        <div className="flex shrink-0 items-center gap-2 border-b px-4 py-2">
          <Button
            size="icon-xs"
            variant="ghost"
            onClick={() => setIsSessionListOpen(!isSessionListOpen)}
            className="hidden md:inline-flex"
          >
            <svg
              className="size-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M3 12h18M3 6h18M3 18h18" />
            </svg>
          </Button>

          <div className="flex-1" />

          <AgentSelector
            workspaceId={activeWorkspaceId}
            selectedAgent={selectedAgent}
            onAgentChange={setSelectedAgent}
          />

          <ModelSelector
            workspaceId={activeWorkspaceId}
            selectedModel={selectedModel}
            onModelChange={setSelectedModel}
          />

          {streamingStatus === "streaming" && (
            <Badge variant="secondary" className="gap-1.5">
              <Loader2 className="size-3 animate-spin" />
              Thinking...
            </Badge>
          )}
        </div>

        {/* Messages */}
        <ScrollArea ref={scrollAreaRef} className="min-h-0 flex-1">
          {activeMessages.length === 0 ? (
            <EmptyChat onSend={handleSendMessage} />
          ) : (
            <div className="pb-4">
              {activeMessages.map((msg) => (
                <ChatMessage key={msg.info.id} message={msg} />
              ))}
            </div>
          )}
        </ScrollArea>

        {/* Permission requests */}
        {activePermissions.length > 0 && (
          <div className="shrink-0 border-t bg-amber-500/10 px-4 py-2">
            {activePermissions.map((permission) => (
              <PermissionBanner
                key={permission.id}
                permission={permission}
                onRespond={(response) => {
                  if (!activeSessionId || !activeWorkspaceId) return
                  respondToPermission(
                    activeSessionId,
                    permission.id,
                    response,
                    activeWorkspaceId
                  )
                }}
              />
            ))}
          </div>
        )}

        {/* Error banner */}
        {streamingError && (
          <div className="flex shrink-0 items-center gap-2 border-t bg-destructive/10 px-4 py-2 text-sm text-destructive">
            <AlertCircle className="size-4 shrink-0" />
            <span className="flex-1">{streamingError}</span>
          </div>
        )}

        {/* Prompt input */}
        <PromptInput
          onSubmit={handleSendMessage}
          onAbort={handleAbort}
          isStreaming={streamingStatus === "streaming"}
          disabled={!activeWorkspaceId}
        />
      </div>
    </div>
  )
}

function EmptyChat({ onSend }: { onSend: (text: string) => void }) {
  const suggestions = [
    "What files are in this project?",
    "Explain the project structure",
    "Find and fix any bugs",
    "Write tests for the main module",
  ]

  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 p-8">
      <div className="text-center">
        <h2 className="text-xl font-semibold">Start a conversation</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Ask OpenCode anything about your project
        </p>
      </div>
      <div className="grid max-w-lg grid-cols-1 gap-2 sm:grid-cols-2">
        {suggestions.map((suggestion) => (
          <Button
            key={suggestion}
            variant="outline"
            className="h-auto whitespace-normal px-4 py-3 text-left text-sm"
            onClick={() => onSend(suggestion)}
          >
            {suggestion}
          </Button>
        ))}
      </div>
    </div>
  )
}

function PermissionBanner({
  permission,
  onRespond,
}: {
  permission: Permission
  onRespond: (response: string) => void
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-amber-500/50 bg-amber-500/5 px-3 py-2">
      <ShieldAlert className="size-5 shrink-0 text-amber-600" />
      <div className="flex-1">
        <p className="text-sm font-medium">{permission.title}</p>
        {permission.pattern && (
          <p className="text-xs text-muted-foreground">
            {Array.isArray(permission.pattern)
              ? permission.pattern.join(", ")
              : permission.pattern}
          </p>
        )}
      </div>
      <div className="flex gap-1.5">
        <Button
          size="sm"
          variant="outline"
          onClick={() => onRespond("deny")}
          className="gap-1"
        >
          <X className="size-3" />
          Deny
        </Button>
        <Button
          size="sm"
          onClick={() => onRespond("allow")}
          className="gap-1"
        >
          <Check className="size-3" />
          Allow
        </Button>
      </div>
    </div>
  )
}

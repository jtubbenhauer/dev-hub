"use client"

import { useEffect, useRef, useCallback, useState, useMemo } from "react"
import { AlertCircle, ShieldAlert, Check, X, MessageCircleQuestion, ScrollText, FileText, Plus } from "lucide-react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useChatStore } from "@/stores/chat-store"
import { useWorkspaceStore } from "@/stores/workspace-store"
import { ChatMessage } from "@/components/chat/message"
import { PromptInput } from "@/components/chat/prompt-input"
import { SessionList } from "@/components/chat/session-list"
import { ModelSelector, loadPersistedModel } from "@/components/chat/model-selector"
import { useAgents, AgentSelector } from "@/components/chat/agent-selector"
import { PlanPanel } from "@/components/chat/plan-panel"
import { useModelAgentBindings } from "@/hooks/use-settings"
import { useCommand } from "@/hooks/use-command"
import type { Permission, QuestionRequest, QuestionInfo, QuestionAnswer, MessageWithParts } from "@/lib/opencode/types"

interface SelectedModel {
  providerID: string
  modelID: string
}

export function ChatInterface() {
  const [selectedModel, setSelectedModel] = useState<SelectedModel | null>(
    () => loadPersistedModel()
  )
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null)
  const [isSessionListOpen, setIsSessionListOpen] = useState(true)
  const [isPlanPanelOpen, setIsPlanPanelOpen] = useState(false)
  const [hasPlanFiles, setHasPlanFiles] = useState(false)
  const scrollAreaRef = useRef<HTMLDivElement>(null)

  const activeWorkspaceId = useWorkspaceStore(
    (state) => state.activeWorkspaceId
  )
  const activeWorkspaceName = useWorkspaceStore(
    (state) => state.activeWorkspace?.name ?? ""
  )

  const { primaryAgents } = useAgents(activeWorkspaceId)
  const { bindings: agentModelBindings } = useModelAgentBindings()

  // Auto-select default agent when agents load
  useEffect(() => {
    if (selectedAgent || primaryAgents.length === 0) return
    const defaultAgent =
      primaryAgents.find((a) => a.name === "code") ?? primaryAgents[0]
    setSelectedAgent(defaultAgent.name)
  }, [primaryAgents, selectedAgent])

  // Auto-switch model when agent changes and a binding exists
  useEffect(() => {
    if (!selectedAgent) return
    const bound = agentModelBindings[selectedAgent]
    if (!bound) return
    setSelectedModel(bound)
  }, [selectedAgent, agentModelBindings])
  const {
    sessions,
    activeSessionId,
    messages,
    streamingStatus,
    streamingError,
    permissions,
    questions,
    setActiveSession,
    setActiveWorkspaceId,
    fetchSessions,
    createSession,
    deleteSession,
    fetchMessages,
    sendMessage,
    abortSession,
    respondToPermission,
    replyToQuestion,
    rejectQuestion,
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

  // Auto-scroll to bottom on new messages or when returning from the plan panel
  const activeMessages = activeSessionId ? messages[activeSessionId] ?? [] : []
  useEffect(() => {
    if (isPlanPanelOpen) return
    // rAF lets the ScrollArea finish mounting before we measure scrollHeight
    const frame = requestAnimationFrame(() => {
      const viewport = scrollAreaRef.current?.querySelector("[data-slot='scroll-area-viewport']")
      if (viewport) {
        viewport.scrollTop = viewport.scrollHeight
      }
    })
    return () => cancelAnimationFrame(frame)
  }, [activeMessages, isPlanPanelOpen])

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

  // Use refs so command closures stay stable but always call latest handlers
  const handleCreateSessionRef = useRef(handleCreateSession)
  handleCreateSessionRef.current = handleCreateSession
  const setIsPlanPanelOpenRef = useRef(setIsPlanPanelOpen)
  setIsPlanPanelOpenRef.current = setIsPlanPanelOpen

  const chatCommands = useMemo(
    () => [
      {
        id: "chat:toggle-plan-panel",
        label: "Toggle Plan Panel",
        group: "Chat",
        icon: ScrollText,
        onSelect: () => setIsPlanPanelOpenRef.current((prev) => !prev),
      },
      {
        id: "chat:new-session",
        label: "New Session",
        group: "Chat",
        icon: Plus,
        onSelect: () => handleCreateSessionRef.current(),
      },
    ],
    []
  )

  useCommand(chatCommands)

  const activePermissions = permissions.filter(
    (p) => p.sessionID === activeSessionId
  )

  const activeQuestions = questions.filter(
    (q) => q.sessionID === activeSessionId
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
    <div className="flex h-full min-h-0 min-w-0 w-full">
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
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
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

          <Button
            size="icon-sm"
            variant={isPlanPanelOpen ? "secondary" : "outline"}
            onClick={() => setIsPlanPanelOpen(!isPlanPanelOpen)}
            title="Plan notes"
          >
            <ScrollText className="size-4" />
          </Button>

          <AgentSelector
            agents={primaryAgents}
            selectedAgent={selectedAgent}
            onAgentChange={setSelectedAgent}
          />

          <ModelSelector
            workspaceId={activeWorkspaceId}
            selectedModel={selectedModel}
            onModelChange={setSelectedModel}
          />
        </div>

        {/* Messages area or plan panel — mutually exclusive */}
        <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
          {isPlanPanelOpen && activeWorkspaceId ? (
            <PlanPanel
              workspaceId={activeWorkspaceId}
              workspaceName={activeWorkspaceName}
              isOpen={isPlanPanelOpen}
              onClose={() => setIsPlanPanelOpen(false)}
              onPlanFilesChange={setHasPlanFiles}
            />
          ) : (
            <ScrollArea ref={scrollAreaRef} className="h-full">
              {activeMessages.length === 0 ? (
                <EmptyChat onSend={handleSendMessage} />
              ) : (
                <div className="pb-4">
                  {activeMessages.map((msg) => (
                    <ChatMessage key={msg.info.id} message={msg} />
                  ))}
                  {streamingStatus === "streaming" && (
                    <StreamingIndicator messages={activeMessages} />
                  )}
                </div>
              )}
            </ScrollArea>
          )}
        </div>

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

        {/* Question requests */}
        {activeQuestions.length > 0 && (
          <div className="shrink-0 border-t bg-indigo-500/10 px-4 py-2 space-y-2">
            {activeQuestions.map((question) => (
              <QuestionBanner
                key={question.id}
                request={question}
                onReply={(answers) => {
                  if (!activeWorkspaceId) return
                  replyToQuestion(question.id, answers, activeWorkspaceId)
                }}
                onReject={() => {
                  if (!activeWorkspaceId) return
                  rejectQuestion(question.id, activeWorkspaceId)
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
            <Button
              size="icon-xs"
              variant="ghost"
              className="shrink-0 text-destructive hover:text-destructive"
              onClick={() => useChatStore.setState({ streamingError: null, streamingStatus: "idle" })}
            >
              <X className="size-3" />
            </Button>
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

function StreamingIndicator({ messages }: { messages: MessageWithParts[] }) {
  const label = useMemo(() => {
    // Walk parts of the last assistant message to find the most recent activity
    const lastAssistant = [...messages].reverse().find((m) => m.info.role === "assistant")
    if (!lastAssistant) return "Thinking..."

    const { parts } = lastAssistant

    // Running tool → most informative signal
    const runningTool = [...parts]
      .reverse()
      .find((p) => p.type === "tool" && p.state.status === "running")
    if (runningTool?.type === "tool") {
      return `Running: ${runningTool.state.status === "running" && runningTool.state.title ? runningTool.state.title : runningTool.tool}`
    }

    // Subtask spawned
    const subtask = [...parts].reverse().find((p) => p.type === "subtask")
    if (subtask?.type === "subtask") {
      return `Subagent: ${subtask.description || subtask.agent}`
    }

    return "Thinking..."
  }, [messages])

  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className="flex gap-1">
        <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/50 [animation-delay:-0.3s]" />
        <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/50 [animation-delay:-0.15s]" />
        <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/50" />
      </div>
      <span className="text-xs text-muted-foreground">{label}</span>
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

function QuestionBanner({
  request,
  onReply,
  onReject,
}: {
  request: QuestionRequest
  onReply: (answers: QuestionAnswer[]) => void
  onReject: () => void
}) {
  // One selection state per question in the request
  const [selections, setSelections] = useState<string[][]>(
    () => request.questions.map(() => [])
  )
  const [customInputs, setCustomInputs] = useState<string[]>(
    () => request.questions.map(() => "")
  )

  const toggleOption = (questionIndex: number, label: string, isMultiple: boolean) => {
    setSelections((prev) => {
      const next = [...prev]
      const current = next[questionIndex]
      if (isMultiple) {
        next[questionIndex] = current.includes(label)
          ? current.filter((l) => l !== label)
          : [...current, label]
      } else {
        next[questionIndex] = current.includes(label) ? [] : [label]
      }
      return next
    })
  }

  const handleSubmit = () => {
    const answers: QuestionAnswer[] = request.questions.map((q, i) => {
      const selected = selections[i]
      const custom = customInputs[i].trim()
      if (custom && selected.length === 0) return [custom]
      if (custom) return [...selected, custom]
      return selected
    })
    onReply(answers)
  }

  const hasAnySelection = selections.some((s) => s.length > 0) ||
    customInputs.some((c) => c.trim().length > 0)

  return (
    <div className="rounded-lg border border-indigo-500/50 bg-indigo-500/5 px-3 py-2 space-y-3">
      {request.questions.map((q, questionIndex) => (
        <QuestionItem
          key={questionIndex}
          question={q}
          selected={selections[questionIndex]}
          customInput={customInputs[questionIndex]}
          onToggleOption={(label) =>
            toggleOption(questionIndex, label, q.multiple === true)
          }
          onCustomInputChange={(value) => {
            setCustomInputs((prev) => {
              const next = [...prev]
              next[questionIndex] = value
              return next
            })
          }}
        />
      ))}
      <div className="flex justify-end gap-1.5">
        <Button size="sm" variant="outline" onClick={onReject} className="gap-1">
          <X className="size-3" />
          Skip
        </Button>
        <Button
          size="sm"
          onClick={handleSubmit}
          disabled={!hasAnySelection}
          className="gap-1"
        >
          <Check className="size-3" />
          Reply
        </Button>
      </div>
    </div>
  )
}

function QuestionItem({
  question,
  selected,
  customInput,
  onToggleOption,
  onCustomInputChange,
}: {
  question: QuestionInfo
  selected: string[]
  customInput: string
  onToggleOption: (label: string) => void
  onCustomInputChange: (value: string) => void
}) {
  const allowCustom = question.custom !== false

  return (
    <div className="space-y-2">
      <div className="flex items-start gap-2">
        <MessageCircleQuestion className="size-5 shrink-0 text-indigo-600 mt-0.5" />
        <div>
          <p className="text-sm font-medium">{question.header}</p>
          <p className="text-xs text-muted-foreground">{question.question}</p>
        </div>
      </div>

      {question.options.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pl-7">
          {question.options.map((option) => {
            const isSelected = selected.includes(option.label)
            return (
              <button
                key={option.label}
                onClick={() => onToggleOption(option.label)}
                className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
                  isSelected
                    ? "border-indigo-500 bg-indigo-500/20 text-indigo-700 dark:text-indigo-300"
                    : "border-border bg-background hover:bg-muted"
                }`}
                title={option.description}
              >
                {option.label}
              </button>
            )
          })}
        </div>
      )}

      {allowCustom && (
        <div className="pl-7">
          <Input
            value={customInput}
            onChange={(e) => onCustomInputChange(e.target.value)}
            placeholder="Type a custom answer..."
            className="h-8 text-xs"
          />
        </div>
      )}
    </div>
  )
}

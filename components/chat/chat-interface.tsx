"use client"

import { useEffect, useRef, useCallback, useState, useMemo, Component } from "react"
import type { ReactNode } from "react"
import { AlertCircle, ShieldAlert, Check, X, MessageCircleQuestion, ScrollText, FileText, Plus, MessageSquare, ArrowDown } from "lucide-react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
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
import type { Permission, QuestionRequest, QuestionInfo, QuestionAnswer, MessageWithParts, SessionStatus } from "@/lib/opencode/types"

interface SelectedModel {
  providerID: string
  modelID: string
}

class QuestionErrorBoundary extends Component<
  { children: ReactNode; onDismissAll: () => void },
  { hasError: boolean }
> {
  constructor(props: { children: ReactNode; onDismissAll: () => void }) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error: Error) {
    console.error("[chat] QuestionBanner render error:", error)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>Could not display question.</span>
          <Button size="sm" variant="outline" onClick={this.props.onDismissAll} className="h-6 gap-1 px-2 text-xs">
            <X className="size-3" />
            Dismiss
          </Button>
        </div>
      )
    }
    return this.props.children
  }
}

export function ChatInterface() {
  const [selectedModel, setSelectedModel] = useState<SelectedModel | null>(
    () => loadPersistedModel()
  )
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null)
  const [isSessionListOpen, setIsSessionListOpen] = useState(true)
  const [isMobileSessionsOpen, setIsMobileSessionsOpen] = useState(false)
  const [isPlanPanelOpen, setIsPlanPanelOpen] = useState(false)
  const [hasPlanFiles, setHasPlanFiles] = useState(false)
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const isNearBottom = useRef(true)
  const [showJumpToBottom, setShowJumpToBottom] = useState(false)

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
    activeSessionId,
    streamingError,
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
    getActiveWorkspaceSessions,
    getActiveSessionMessages,
    getActiveSessionStatus,
    getActivePermissions,
    getActiveQuestions,
    getActiveSessionStatuses,
    getStreamingStatus,
  } = useChatStore()

  // getStreamingStatus must be passed as a stable reference — inline lambdas like
  // `(s) => s.getStreamingStatus()` create a new function each render, which causes
  // useSyncExternalStore to see a "new snapshot" every tick → infinite re-render loop.
  const streamingStatus = useChatStore(getStreamingStatus)

  const sessions = useChatStore(getActiveWorkspaceSessions)
  const sessionStatus = useChatStore(getActiveSessionStatus)
  // getActivePermissions / getActiveQuestions return raw workspace arrays (stable refs).
  // We filter by sessionID here with useMemo so we never create a new array reference
  // on every render — that would violate useSyncExternalStore's snapshot contract and
  // cause "Maximum update depth exceeded" via the ScrollArea ref cascade.
  const allPermissions = useChatStore(getActivePermissions)
  const allQuestions = useChatStore(getActiveQuestions)
  const sessionStatuses = useChatStore(getActiveSessionStatuses)

  const activePermissions = useMemo(
    () => allPermissions.filter((p) => p.sessionID === activeSessionId),
    [allPermissions, activeSessionId]
  )
  const activeQuestions = useMemo(
    () => allQuestions.filter((q) => q.sessionID === activeSessionId),
    [allQuestions, activeSessionId]
  )

  // Sync workspace from global workspace store
  useEffect(() => {
    setActiveWorkspaceId(activeWorkspaceId)
  }, [activeWorkspaceId, setActiveWorkspaceId])

  // Connect SSE when workspace changes (state switch + SSE happen inside setActiveWorkspaceId,
  // but we also need to fetch sessions if the workspace is being visited for the first time)
  useEffect(() => {
    if (!activeWorkspaceId) return
    fetchSessions(activeWorkspaceId)
    connectSSE(activeWorkspaceId)
    // SSE connections now live per-workspace and are not torn down on unmount
  }, [activeWorkspaceId, fetchSessions, connectSSE])

  // Fetch messages when active session changes
  useEffect(() => {
    if (!activeSessionId || !activeWorkspaceId) return
    fetchMessages(activeSessionId, activeWorkspaceId)
  }, [activeSessionId, activeWorkspaceId, fetchMessages])

  const activeMessages = useChatStore(getActiveSessionMessages)

  // Auto-scroll to bottom only when the user is already near the bottom
  useEffect(() => {
    if (isPlanPanelOpen || !isNearBottom.current) return
    const frame = requestAnimationFrame(() => {
      const viewport = scrollAreaRef.current?.querySelector("[data-slot='scroll-area-viewport']")
      if (viewport) {
        viewport.scrollTop = viewport.scrollHeight
      }
    })
    return () => cancelAnimationFrame(frame)
  }, [activeMessages, isPlanPanelOpen])

  // Detect when the user scrolls away from the bottom and show the jump button
  useEffect(() => {
    const viewport = scrollAreaRef.current?.querySelector("[data-slot='scroll-area-viewport']")
    if (!viewport) return

    let rafHandle: number | null = null
    const handleScroll = () => {
      if (rafHandle !== null) return
      rafHandle = requestAnimationFrame(() => {
        rafHandle = null
        const atBottom = viewport.scrollTop + viewport.clientHeight >= viewport.scrollHeight - 80
        if (atBottom !== isNearBottom.current) {
          isNearBottom.current = atBottom
          setShowJumpToBottom(!atBottom)
        }
      })
    }

    viewport.addEventListener("scroll", handleScroll, { passive: true })
    return () => {
      viewport.removeEventListener("scroll", handleScroll)
      if (rafHandle !== null) cancelAnimationFrame(rafHandle)
    }
  }, [])

  // Reset scroll state when switching sessions
  useEffect(() => {
    isNearBottom.current = true
    setShowJumpToBottom(false)
  }, [activeSessionId])

  const handleSendMessage = useCallback(
    async (text: string) => {
      if (!activeWorkspaceId) return

      // Always scroll to bottom when the user sends a message
      isNearBottom.current = true
      setShowJumpToBottom(false)

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

  const handleJumpToBottom = useCallback(() => {
    isNearBottom.current = true
    setShowJumpToBottom(false)
    const viewport = scrollAreaRef.current?.querySelector("[data-slot='scroll-area-viewport']")
    if (viewport) {
      viewport.scrollTop = viewport.scrollHeight
    }
  }, [])

  const handleAbort = useCallback(() => {    if (!activeSessionId || !activeWorkspaceId) return
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

  const handleMobileSelectSession = useCallback(
    (sessionId: string) => {
      setActiveSession(sessionId)
      setIsMobileSessionsOpen(false)
    },
    [setActiveSession]
  )

  const handleMobileCreateSession = useCallback(() => {
    if (!activeWorkspaceId) return
    createSession(activeWorkspaceId)
    setIsMobileSessionsOpen(false)
  }, [activeWorkspaceId, createSession])

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
      {/* Mobile session sheet */}
      <Sheet open={isMobileSessionsOpen} onOpenChange={setIsMobileSessionsOpen}>
        <SheetContent side="left" className="w-72 p-0" showCloseButton={false}>
          <SheetHeader className="sr-only">
            <SheetTitle>Sessions</SheetTitle>
          </SheetHeader>
          <SessionList
            sessions={sessions}
            activeSessionId={activeSessionId}
            sessionStatuses={sessionStatuses}
            onSelectSession={handleMobileSelectSession}
            onCreateSession={handleMobileCreateSession}
            onDeleteSession={handleDeleteSession}
          />
        </SheetContent>
      </Sheet>

      {/* Session sidebar — hidden on mobile by default */}
      {isSessionListOpen && (
        <div className="hidden w-60 shrink-0 overflow-hidden md:block">
          <SessionList
            sessions={sessions}
            activeSessionId={activeSessionId}
            sessionStatuses={sessionStatuses}
            onSelectSession={handleSelectSession}
            onCreateSession={handleCreateSession}
            onDeleteSession={handleDeleteSession}
          />
        </div>
      )}

      {/* Main chat area */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {/* Chat toolbar */}
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-2">
          {/* Mobile: open session sheet */}
          <Button
            size="icon-xs"
            variant="ghost"
            onClick={() => setIsMobileSessionsOpen(true)}
            className="md:hidden"
          >
            <MessageSquare className="size-4" />
          </Button>
          {/* Desktop: toggle session sidebar */}
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
        <div className="chat-scroll-area relative min-h-0 min-w-0 flex-1 overflow-hidden">
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
                <div className="min-w-0 overflow-hidden pb-4">
                  {activeMessages.map((msg) => (
                    <ChatMessage key={msg.info.id} message={msg} />
                  ))}
                  {streamingStatus === "streaming" && (
                    <StreamingIndicator messages={activeMessages} sessionStatus={sessionStatus} />
                  )}
                </div>
              )}
            </ScrollArea>
          )}

          {/* Jump-to-bottom pill — shown when user has scrolled up during streaming or after */}
          {showJumpToBottom && activeMessages.length > 0 && !isPlanPanelOpen && (
            <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center">
              <button
                onClick={handleJumpToBottom}
                className="pointer-events-auto flex items-center gap-1.5 rounded-full border bg-background px-3 py-1.5 text-xs font-medium shadow-md transition-opacity hover:bg-muted"
              >
                <ArrowDown className="size-3" />
                Jump to bottom
              </button>
            </div>
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
            <QuestionErrorBoundary
              key={activeQuestions.map((q) => q.id).join(",")}
              onDismissAll={() => {
                if (!activeWorkspaceId) return
                activeQuestions.forEach((q) => rejectQuestion(q.id, activeWorkspaceId))
              }}
            >
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
            </QuestionErrorBoundary>
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
              onClick={() => useChatStore.setState({ streamingError: null })}
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

function StreamingIndicator({
  messages,
  sessionStatus,
}: {
  messages: MessageWithParts[]
  sessionStatus: SessionStatus | null
}) {
  const label = useMemo(() => {
    // Session-level status takes priority
    if (sessionStatus?.type === "retry") {
      const secondsUntilRetry = Math.max(0, Math.ceil((sessionStatus.next - Date.now()) / 1000))
      return `Retrying... attempt ${sessionStatus.attempt}${secondsUntilRetry > 0 ? ` · ${secondsUntilRetry}s` : ""}`
    }

    // Walk parts of the last assistant message to find the most recent activity
    const lastAssistant = [...messages].reverse().find((m) => m.info.role === "assistant")
    if (!lastAssistant) return "Thinking..."

    const { parts } = lastAssistant

    // Compaction in progress
    const hasCompaction = parts.some((p) => p.type === "compaction")
    if (hasCompaction) return "Compacting context..."

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
  }, [messages, sessionStatus])

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
  const questionList = request.questions ?? []

  // One selection state per question in the request
  const [selections, setSelections] = useState<string[][]>(
    () => questionList.map(() => [])
  )
  const [customInputs, setCustomInputs] = useState<string[]>(
    () => questionList.map(() => "")
  )

  const toggleOption = (questionIndex: number, label: string, isMultiple: boolean) => {
    setSelections((prev) => {
      const next = [...prev]
      const current = next[questionIndex] ?? []
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
    const answers: QuestionAnswer[] = questionList.map((q, i) => {
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

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey && hasAnySelection) {
      e.preventDefault()
      handleSubmit()
    }
  }

  return (
    <div className="rounded-lg border border-indigo-500/50 bg-indigo-500/5 px-3 py-2 space-y-3">
      {questionList.map((q, questionIndex) => (
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
          onSubmitOnEnter={handleInputKeyDown}
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
  onSubmitOnEnter,
}: {
  question: QuestionInfo
  selected: string[]
  customInput: string
  onToggleOption: (label: string) => void
  onCustomInputChange: (value: string) => void
  onSubmitOnEnter: (e: React.KeyboardEvent<HTMLInputElement>) => void
}) {
  const allowCustom = question.custom !== false
  const options = question.options ?? []

  return (
    <div className="space-y-2">
      <div className="flex items-start gap-2">
        <MessageCircleQuestion className="size-5 shrink-0 text-indigo-600 mt-0.5" />
        <div>
          <p className="text-sm font-medium">{question.header}</p>
          <p className="text-xs text-muted-foreground">{question.question}</p>
        </div>
      </div>

      {options.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pl-7">
          {options.map((option) => {
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
            onKeyDown={onSubmitOnEnter}
            placeholder="Type a custom answer..."
            className="h-8 text-xs"
          />
        </div>
      )}
    </div>
  )
}

"use client";

import { AgentSelector, useAgents } from "@/components/chat/agent-selector";
import type { SlashCommand } from "@/components/chat/command-picker";
import { ChatDisplayContext } from "@/components/chat/chat-display-context";
import { ChatMessage, isMessageVisible } from "@/components/chat/message";
import { ModelSelector, loadPersistedModel } from "@/components/chat/model-selector";
import { PlanPanel } from "@/components/chat/plan-panel";
import type { PromptInputHandle } from "@/components/chat/prompt-input";
import { PromptInput } from "@/components/chat/prompt-input";
import { SessionList } from "@/components/chat/session-list";
import { TaskProgressPanel } from "@/components/chat/task-progress";
import { McpStatusPanel } from "@/components/chat/mcp-status";
import { VariantSelector } from "@/components/chat/variant-selector";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { shouldSSEConnect } from "@/lib/workspaces/behaviour";
import { useCommand } from "@/hooks/use-command";
import { useLeaderAction } from "@/hooks/use-leader-action";
import { useIsMobile } from "@/hooks/use-mobile";
import { useResizablePanel } from "@/hooks/use-resizable-panel";
import { useModelAgentBindings } from "@/hooks/use-settings";
import type { Command, MessageWithParts, PermissionRequest, QuestionAnswer, QuestionInfo, QuestionRequest, SessionStatus } from "@/lib/opencode/types";
import { useChatStore } from "@/stores/chat-store";
import type { SessionWithWorkspace } from "@/stores/chat-store";
import { usePendingChatStore } from "@/stores/pending-chat-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useQueries } from "@tanstack/react-query";
import { AlertCircle, ArrowDown, Brain, Check, ChevronDown, ChevronRight, Clock, Coins, GripVertical, LayoutList, ListTodo, Loader2, MessageCircleQuestion, MessageSquare, PanelTop, Plus, ScrollText, ShieldAlert, Wrench, X } from "lucide-react";
import type { ReactNode } from "react";
import { Component, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { VirtuosoHandle } from "react-virtuoso";
import { Virtuoso } from "react-virtuoso";

interface SelectedModel {
  providerID: string;
  modelID: string;
}

class QuestionErrorBoundary extends Component<
  { children: ReactNode; onDismissAll: () => void },
  { hasError: boolean }
> {
  constructor(props: { children: ReactNode; onDismissAll: () => void }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    console.error("[chat] QuestionBanner render error:", error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>Could not display question.</span>
          <Button
            size="sm"
            variant="outline"
            onClick={this.props.onDismissAll}
            className="h-6 gap-1 px-2 text-xs"
          >
            <X className="size-3" />
            Dismiss
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}

const EMPTY_LAST_VIEWED: Record<string, number> = {}

export function ChatInterface() {
  const [selectedModel, setSelectedModel] = useState<SelectedModel | null>(() =>
    loadPersistedModel(),
  );
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [selectedVariant, setSelectedVariant] = useState<string | null>(null);
  const [availableVariants, setAvailableVariants] = useState<string[]>([]);
  const [isSessionListOpen, setIsSessionListOpen] = useState(true);
  const [isMobileSessionsOpen, setIsMobileSessionsOpen] = useState(false);
  const [isUnifiedMode, setIsUnifiedMode] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("dev-hub:chat-unified-mode") === "true";
  });
  const [groupByWorkspace, setGroupByWorkspace] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("dev-hub:chat-group-by-workspace") === "true";
  });
  const [workspaceOrder, setWorkspaceOrder] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      return JSON.parse(localStorage.getItem("dev-hub:chat-workspace-order") ?? "[]");
    } catch {
      return [];
    }
  });
  const [expandedWorkspaces, setExpandedWorkspaces] = useState<Record<string, boolean>>(() => {
    if (typeof window === "undefined") return {};
    try {
      return JSON.parse(localStorage.getItem("dev-hub:chat-expanded-workspaces") ?? "{}");
    } catch {
      return {};
    }
  });
  const [questionViewMode, setQuestionViewMode] = useState<"list" | "tabs">(() => {
    if (typeof window === "undefined") return "list";
    const stored = localStorage.getItem("dev-hub:chat-question-view");
    return stored === "tabs" ? "tabs" : "list";
  });
  const [isQuestionsMinimized, setIsQuestionsMinimized] = useState(false);

  const {
    width: sessionListWidth,
    handleDragStart: handleSessionListDragStart,
  } = useResizablePanel({
    minWidth: 160,
    maxWidth: 400,
    defaultWidth: 240,
    storageKey: "dev-hub:chat-panel-width",
  });
  const [showThinking, setShowThinking] = useState(() => {
    if (typeof window === "undefined") return true;
    return localStorage.getItem("dev-hub:chat-show-thinking") !== "false";
  });
  const [showToolCalls, setShowToolCalls] = useState(() => {
    if (typeof window === "undefined") return true;
    return localStorage.getItem("dev-hub:chat-show-tool-calls") !== "false";
  });
  const [showTokens, setShowTokens] = useState(() => {
    if (typeof window === "undefined") return true;
    return localStorage.getItem("dev-hub:chat-show-tokens") !== "false";
  });
  const [showTimestamps, setShowTimestamps] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("dev-hub:chat-show-timestamps") === "true";
  });
  const chatDisplaySettings = useMemo(
    () => ({ showThinking, showToolCalls, showTokens, showTimestamps }),
    [showThinking, showToolCalls, showTokens, showTimestamps],
  );
  const [isTaskPanelOpen, setIsTaskPanelOpen] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("dev-hub:chat-task-panel") === "true";
  });
  const {
    width: taskPanelWidth,
    handleDragStart: handleTaskPanelDragStart,
  } = useResizablePanel({
    minWidth: 200,
    maxWidth: 400,
    defaultWidth: 280,
    storageKey: "dev-hub:chat-task-panel-width",
    reverse: true,
  });
  const [isPlanPanelOpen, setIsPlanPanelOpen] = useState(false);
  const [hasPlanFiles, setHasPlanFiles] = useState(false);
  const [isModelSelectorOpen, setIsModelSelectorOpen] = useState(false);
  const [isAgentSelectorOpen, setIsAgentSelectorOpen] = useState(false);
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const promptInputRef = useRef<PromptInputHandle>(null);
  const sessionListFocusRef = useRef<HTMLDivElement>(null);
  const messagesPanelFocusRef = useRef<HTMLDivElement>(null);
  const taskPanelFocusRef = useRef<HTMLDivElement>(null);
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);

  const activeWorkspaceId = useWorkspaceStore(
    (state) => state.activeWorkspaceId,
  );
  const activeWorkspaceName = useWorkspaceStore(
    (state) => state.activeWorkspace?.name ?? "",
  );
  const allWorkspaces = useWorkspaceStore((state) => state.workspaces);

  const activeWorkspaceColor = useMemo(() => {
    if (!activeWorkspaceId) return undefined;
    const ws = allWorkspaces.find((w) => w.id === activeWorkspaceId);
    return ws?.color ?? undefined;
  }, [allWorkspaces, activeWorkspaceId]);

  const workspaceNames = useMemo(() => {
    const map: Record<string, string> = {};
    for (const ws of allWorkspaces) map[ws.id] = ws.name;
    return map;
  }, [allWorkspaces]);

  const workspaceColors = useMemo(() => {
    const map: Record<string, string> = {};
    for (const ws of allWorkspaces) {
      if (ws.color) map[ws.id] = ws.color;
    }
    return map;
  }, [allWorkspaces]);

  const branchQueryResults = useQueries({
    queries: allWorkspaces.map((ws) => ({
      queryKey: ["git-status", ws.id],
      queryFn: async () => {
        const params = new URLSearchParams({ action: "status" })
        const res = await fetch(`/api/workspaces/${ws.id}/git?${params}`)
        if (!res.ok) return null
        return res.json() as Promise<{ branch: string }>
      },
      enabled: isUnifiedMode,
      staleTime: 30_000,
      retry: false,
    })),
  })

  const workspaceBranches = useMemo(() => {
    const map: Record<string, string> = {}
    for (let i = 0; i < allWorkspaces.length; i++) {
      const data = branchQueryResults[i]?.data
      if (data?.branch) {
        map[allWorkspaces[i].id] = data.branch
      }
    }
    return map
  }, [allWorkspaces, branchQueryResults])

  const workspaceOptions = useMemo(() => {
    return allWorkspaces.map((ws) => ({
      id: ws.id,
      name: ws.name,
      backend: ws.backend,
    }));
  }, [allWorkspaces]);

  const sleepingWorkspaceIds = useMemo(() => {
    const ids = new Set<string>();
    for (const ws of allWorkspaces) {
      if (!shouldSSEConnect(ws, activeWorkspaceId)) {
        ids.add(ws.id);
      }
    }
    return ids;
  }, [allWorkspaces, activeWorkspaceId]);

  const { primaryAgents } = useAgents(activeWorkspaceId);
  const orderedAgents = useMemo(() => {
    const utilityNames = new Set(["compaction", "title", "summary"])
    const regular: typeof primaryAgents = []
    const utility: typeof primaryAgents = []
    for (const agent of primaryAgents) {
      if (utilityNames.has(agent.name.toLowerCase())) {
        utility.push(agent)
      } else {
        regular.push(agent)
      }
    }
    return [...regular, ...utility]
  }, [primaryAgents])
  const { bindings: agentModelBindings } = useModelAgentBindings();

  // Track the previous agent so we only force-set the model when the agent
  // actually changes — not when other deps (primaryAgents, bindings) re-render.
  // This lets the user manually override the model within a session.
  const prevAgentRef = useRef<string | null>(null);

  useEffect(() => {
    if (!selectedAgent || primaryAgents.length === 0) return;

    const agentChanged = prevAgentRef.current !== selectedAgent;
    prevAgentRef.current = selectedAgent;

    const agent = primaryAgents.find((a) => a.name === selectedAgent);

    // When the session has a stored model override, skip auto-deriving model from agent.
    // On agent change within a session, clearSessionModel is called first (see AgentSelector),
    // so this guard only preserves overrides during session switches.
    const hasStoredModel = activeSessionId ? !!getSessionModel(activeSessionId) : false;

    if ((agentChanged || !selectedModel) && !hasStoredModel) {
      if (agent?.model) {
        setSelectedModel(agent.model);
      } else {
        const bound = agentModelBindings[selectedAgent];
        if (bound) setSelectedModel(bound);
      }
    }

    // Agent config can advertise a variant (e.g. "high") not in the model's variant map → API error
    if (agentChanged) {
      const agentVariant = agent?.variant ?? null;
      if (agentVariant && availableVariants.length > 0 && !availableVariants.includes(agentVariant)) {
        setSelectedVariant(null);
      } else {
        setSelectedVariant(agentVariant);
      }
    }
  }, [selectedAgent, primaryAgents, agentModelBindings, availableVariants, selectedModel]);

  useEffect(() => {
    if (selectedVariant && availableVariants.length > 0 && !availableVariants.includes(selectedVariant)) {
      setSelectedVariant(null);
    }
  }, [availableVariants, selectedVariant]);

  const {
    activeSessionId,
    streamingError,
    setActiveSession,
    setActiveWorkspaceId,
    fetchSessions,
    createSession,
    deleteSession,
    removeSessionLocal,
    restoreSessionLocal,
    fetchMessages,
    fetchCommands,
    summarizeSession,
    revertSession,
    sendMessage,
    executeCommand,
    abortSession,
    respondToPermission,
    replyToQuestion,
    rejectQuestion,
    getActiveWorkspaceSessions,
    getActiveSessionMessages,
    getActiveSessionStatus,
    getActivePermissions,
    getActiveQuestions,
    getActiveSessionStatuses,
    getStreamingStatus,
    getRecentSessionsAcrossWorkspaces,
    getActiveTodos,
    getUnifiedSessionStatuses,
    getActiveQuestionSessionIds,
    getUnifiedQuestionSessionIds,
    getUnifiedLastViewedAt,
    getUnifiedPinnedSessionIds,
    getActivePinnedSessionIds,
    setSessionAgent,
    getSessionAgent,
    setSessionModel,
    clearSessionModel,
    getSessionModel,
    fetchPinnedSessions,
    pinSession,
    unpinSession,
    getPinnedSessionIds,
    fetchCachedSessions,
  } = useChatStore();

  // Restore per-session agent when the active session changes.
  // Falls back to "code" (or the first available agent) when the session has no stored agent.
  useEffect(() => {
    if (primaryAgents.length === 0) return;

    // Restore agent
    const storedAgent = activeSessionId ? getSessionAgent(activeSessionId) : null;
    if (storedAgent) {
      setSelectedAgent(storedAgent);
    } else {
      const defaultAgent =
        primaryAgents.find((a) => a.name === "code") ?? primaryAgents[0];
      setSelectedAgent(defaultAgent.name);
    }

    // Restore model override (if session has one stored)
    const storedModel = activeSessionId ? getSessionModel(activeSessionId) : null;
    if (storedModel) {
      setSelectedModel(storedModel);
    }
    // If no stored model, the agent-change useEffect will derive it from agent binding
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSessionId, primaryAgents]);

  // getStreamingStatus must be passed as a stable reference — inline lambdas like
  // `(s) => s.getStreamingStatus()` create a new function each render, which causes
  // useSyncExternalStore to see a "new snapshot" every tick → infinite re-render loop.
  const streamingStatus = useChatStore(getStreamingStatus);
  const isMobile = useIsMobile();

  const sessions = useChatStore(getActiveWorkspaceSessions)
  const activeSessionDirectory = activeSessionId
    ? sessions[activeSessionId]?.directory
    : undefined
  const [unifiedLimit, setUnifiedLimit] = useState(20)
  const effectiveUnifiedLimit = groupByWorkspace ? Number.MAX_SAFE_INTEGER : unifiedLimit
  const allUnifiedSessions = useChatStore((state) =>
    state.getRecentSessionsAcrossWorkspaces(effectiveUnifiedLimit)
  )
  const workspaceIds = useMemo(() => new Set(allWorkspaces.map((w) => w.id)), [allWorkspaces])
  const unifiedSessions = useMemo(
    () => allUnifiedSessions.filter((s) => workspaceIds.has(s.workspaceId)),
    [allUnifiedSessions, workspaceIds]
  )
  const totalUnifiedCount = useChatStore((state) => {
    let count = 0
    for (const ws of Object.values(state.workspaceStates)) {
      for (const session of Object.values(ws.sessions)) {
        if (!session.parentID) count++
      }
    }
    return count
  })
  const hasMoreUnifiedSessions = totalUnifiedCount > unifiedLimit
  const sessionStatus = useChatStore(getActiveSessionStatus)
  const commands: Command[] = useChatStore((state) => state.commands)
  // getActivePermissions / getActiveQuestions return raw workspace arrays (stable refs).
  // We filter by sessionID here with useMemo so we never create a new array reference
  // on every render — that would violate useSyncExternalStore's snapshot contract and
  // cause "Maximum update depth exceeded" via the ScrollArea ref cascade.
  const allPermissions = useChatStore(getActivePermissions);
  const allQuestions = useChatStore(getActiveQuestions);
  const activeWsSessionStatuses = useChatStore(getActiveSessionStatuses);
  const activeWsLastViewedAt = useChatStore((s) => {
    const wsId = s.activeWorkspaceId
    if (!wsId) return EMPTY_LAST_VIEWED
    return s.workspaceStates[wsId]?.lastViewedAt ?? EMPTY_LAST_VIEWED
  });
  const unifiedStatuses = useChatStore(getUnifiedSessionStatuses);
  const unifiedLastViewed = useChatStore(getUnifiedLastViewedAt);
  const sessionStatuses = isUnifiedMode ? unifiedStatuses : activeWsSessionStatuses;
  const lastViewedAt = isUnifiedMode ? unifiedLastViewed : activeWsLastViewedAt;
  const activeTodos = useChatStore(getActiveTodos);
  const unifiedPinnedIds = useChatStore(getUnifiedPinnedSessionIds);
  const activePinnedIds = useChatStore(getActivePinnedSessionIds);
  const pinnedSessionIds = isUnifiedMode ? unifiedPinnedIds : activePinnedIds;
  const activeQuestionSessionIds = useChatStore(getActiveQuestionSessionIds);
  const unifiedQuestionSessionIds = useChatStore(getUnifiedQuestionSessionIds);
  const questionSessionIds = isUnifiedMode ? unifiedQuestionSessionIds : activeQuestionSessionIds;

  const isSessionsLoading = useChatStore((s) => {
    if (isUnifiedMode) {
      return allWorkspaces.some((ws) => !s.workspaceStates[ws.id]?.sessionsLoaded)
    }
    const wsId = s.activeWorkspaceId
    if (!wsId) return false
    return !s.workspaceStates[wsId]?.sessionsLoaded
  });

  const childSessionIds = useMemo(() => {
    if (!activeSessionId) return new Set<string>()
    const childrenOf = new Map<string, string[]>()
    for (const s of Object.values(sessions)) {
      if (s.parentID) {
        const siblings = childrenOf.get(s.parentID) ?? []
        siblings.push(s.id)
        childrenOf.set(s.parentID, siblings)
      }
    }
    const descendants = new Set<string>()
    const queue = [...(childrenOf.get(activeSessionId) ?? [])]
    while (queue.length > 0) {
      const id = queue.shift()!
      if (!descendants.has(id)) {
        descendants.add(id)
        queue.push(...(childrenOf.get(id) ?? []))
      }
    }
    return descendants
  }, [sessions, activeSessionId])

  const activePermissions = useMemo(
    () => allPermissions.filter((p) => p.sessionID === activeSessionId || childSessionIds.has(p.sessionID)),
    [allPermissions, activeSessionId, childSessionIds],
  );
  const activeQuestions = useMemo(
    () => allQuestions.filter((q) => q.sessionID === activeSessionId || childSessionIds.has(q.sessionID)),
    [allQuestions, activeSessionId, childSessionIds],
  );

  // Sync workspace from global workspace store
  useEffect(() => {
    setActiveWorkspaceId(activeWorkspaceId);
  }, [activeWorkspaceId, setActiveWorkspaceId]);

  useEffect(() => {
    if (!activeWorkspaceId) return;
    fetchSessions(activeWorkspaceId);
    fetchCommands(activeWorkspaceId);
    fetchPinnedSessions(activeWorkspaceId);
  }, [activeWorkspaceId, fetchSessions, fetchCommands, fetchPinnedSessions]);

  useEffect(() => {
    if (!isUnifiedMode) return;
    for (const ws of allWorkspaces) {
      if (shouldSSEConnect(ws, activeWorkspaceId)) {
        // Awake workspace — fetch live sessions
        fetchSessions(ws.id);
        fetchPinnedSessions(ws.id);
      } else {
        // Sleeping workspace — use cached sessions from DB
        fetchCachedSessions(ws.id);
      }
    }
  }, [isUnifiedMode, allWorkspaces, activeWorkspaceId, fetchSessions, fetchPinnedSessions, fetchCachedSessions]);

  // Fetch messages when active session changes
  useEffect(() => {
    if (!activeSessionId || !activeWorkspaceId) return;
    fetchMessages(activeSessionId, activeWorkspaceId);
  }, [activeSessionId, activeWorkspaceId, fetchMessages]);

  // Consume pending chat (e.g. from "Create Worktree" → auto-start plan)
  const pendingChat = usePendingChatStore((s) => s.pending);
  const clearPendingChat = usePendingChatStore((s) => s.clear);
  useEffect(() => {
    if (!activeWorkspaceId || !pendingChat) return;
    if (pendingChat.workspaceId !== activeWorkspaceId) return;

    // Clear immediately so it only fires once
    const { message } = pendingChat;
    clearPendingChat();

    // Create a session and send the pending message
    (async () => {
      const session = await createSession(activeWorkspaceId);
      if (!session) return;
      sendMessage(session.id, message, activeWorkspaceId);
    })();
  }, [
    activeWorkspaceId,
    pendingChat,
    clearPendingChat,
    createSession,
    sendMessage,
  ]);

  const activeMessagesRaw = useChatStore(getActiveSessionMessages);
  const activeMessages = useMemo(
    () => activeMessagesRaw.filter((m) => isMessageVisible(m, { showThinking, showToolCalls })),
    [activeMessagesRaw, showThinking, showToolCalls]
  );
  const isMessagesLoaded = useChatStore((state) => {
    const {
      activeSessionId: sid,
      activeWorkspaceId: wid,
      workspaceStates,
    } = state;
    if (!sid || !wid) return true;
    const ws = workspaceStates[wid];
    if (!ws) return false;
    return sid in ws.messages;
  });

  const [showLoader, setShowLoader] = useState(false);
  useEffect(() => {
    if (isMessagesLoaded) {
      setShowLoader(false);
      return;
    }
    const timer = setTimeout(() => setShowLoader(true), 300);
    return () => clearTimeout(timer);
  }, [isMessagesLoaded, activeSessionId]);

  // Virtuoso handles auto-scroll via followOutput and atBottomStateChange.
  // Reset jump-to-bottom when switching sessions.
  useEffect(() => {
    setShowJumpToBottom(false);
  }, [activeSessionId]);

  const handleAtBottomStateChange = useCallback((atBottom: boolean) => {
    setShowJumpToBottom(!atBottom);
  }, []);

  // Snap to bottom instantly during streaming so growing content doesn't undershoot
  const handleFollowOutput = useCallback((isAtBottom: boolean) => {
    return isAtBottom ? ("auto" as const) : (false as const);
  }, []);

  const handleSendMessage = useCallback(
    async (text: string) => {
      if (!activeWorkspaceId) return;

      // Always scroll to bottom when the user sends a message
      setShowJumpToBottom(false);
      requestAnimationFrame(() => {
        virtuosoRef.current?.scrollToIndex({ index: "LAST", align: "end" });
      });

      let sessionId = activeSessionId;
      if (!sessionId) {
        const newSession = await createSession(activeWorkspaceId);
        if (!newSession) return;
        sessionId = newSession.id;
      }

      sendMessage(
        sessionId,
        text,
        activeWorkspaceId,
        selectedModel ?? undefined,
        selectedAgent ?? undefined,
        selectedVariant ?? undefined,
      );
    },
    [
      activeWorkspaceId,
      activeSessionId,
      selectedModel,
      selectedAgent,
      selectedVariant,
      createSession,
      sendMessage,
    ],
  );

  const handleCommandDispatch = useCallback(
    async (command: SlashCommand, args: string) => {
      if (!activeWorkspaceId) return;

      let sessionId = activeSessionId;
      if (!sessionId) {
        const newSession = await createSession(activeWorkspaceId);
        if (!newSession) return;
        sessionId = newSession.id;
      }

      setShowJumpToBottom(false);
      requestAnimationFrame(() => {
        virtuosoRef.current?.scrollToIndex({ index: "LAST", align: "end" });
      });

      if (command.source === "builtin") {
        switch (command.name) {
          case "compact": {
            const compactionAgent = primaryAgents.find((a) => a.name.toLowerCase() === "compaction")
            const compactModel = compactionAgent?.model ?? selectedModel ?? undefined
            summarizeSession(sessionId, activeWorkspaceId, compactModel);
            break;
          }
          case "undo": {
            const lastAssistant = [...activeMessages]
              .reverse()
              .find((m) => m.info.role === "assistant");
            if (lastAssistant) {
              revertSession(
                sessionId,
                activeWorkspaceId,
                lastAssistant.info.id,
              );
            }
            break;
          }
        }
      } else {
        executeCommand(
          sessionId,
          activeWorkspaceId,
          command.name,
          args,
          selectedModel ?? undefined,
          selectedAgent ?? undefined,
          selectedVariant ?? undefined,
        );
      }
    },
    [
      activeWorkspaceId,
      activeSessionId,
      activeMessages,
      primaryAgents,
      createSession,
      summarizeSession,
      revertSession,
      executeCommand,
      selectedModel,
      selectedAgent,
      selectedVariant,
    ],
  );

  const handleJumpToBottom = useCallback(() => {
    setShowJumpToBottom(false);
    virtuosoRef.current?.scrollToIndex({
      index: "LAST",
      align: "end",
      behavior: "smooth",
    });
  }, []);

  const handleAbort = useCallback(() => {
    if (!activeSessionId || !activeWorkspaceId) return;
    abortSession(activeSessionId, activeWorkspaceId);
  }, [activeSessionId, activeWorkspaceId, abortSession]);

  const handleRevert = useCallback(
    async (messageId: string) => {
      if (!activeSessionId || !activeWorkspaceId) return;
      const text = await revertSession(activeSessionId, activeWorkspaceId, messageId);
      if (text) {
        promptInputRef.current?.setValue(text);
      }
    },
    [activeSessionId, activeWorkspaceId, revertSession],
  );

  const handleCreateSession = useCallback(() => {
    if (!activeWorkspaceId) return;
    createSession(activeWorkspaceId);
  }, [activeWorkspaceId, createSession]);

  const handleCreateSessionInWorkspace = useCallback(
    (workspaceId: string) => {
      useWorkspaceStore.getState().setActiveWorkspaceId(workspaceId);
      setActiveWorkspaceId(workspaceId);
      createSession(workspaceId);
    },
    [setActiveWorkspaceId, createSession],
  );

  const pendingDeletions = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    const ref = pendingDeletions.current;
    return () => {
      for (const timer of ref.values()) clearTimeout(timer);
      ref.clear();
    };
  }, []);

  const handleDeleteSession = useCallback(
    (sessionId: string, sessionWorkspaceId?: string) => {
      const workspaceId = sessionWorkspaceId ?? activeWorkspaceId;
      if (!workspaceId) return;

      const existing = pendingDeletions.current.get(sessionId);
      if (existing) clearTimeout(existing);

      const snapshot = removeSessionLocal(sessionId, workspaceId);
      if (!snapshot) return;

      const timer = setTimeout(() => {
        pendingDeletions.current.delete(sessionId);
        deleteSession(sessionId, workspaceId);
      }, 5000);

      pendingDeletions.current.set(sessionId, timer);

      toast.success("Chat deleted", {
        duration: 5000,
        action: {
          label: "Undo",
          onClick: () => {
            const pending = pendingDeletions.current.get(sessionId);
            if (pending) {
              clearTimeout(pending);
              pendingDeletions.current.delete(sessionId);
            }
            restoreSessionLocal(snapshot);
          },
        },
      });
    },
    [activeWorkspaceId, deleteSession, removeSessionLocal, restoreSessionLocal],
  );

  const handleSelectSession = useCallback(
    (sessionId: string) => {
      setActiveSession(sessionId);
      requestAnimationFrame(() => promptInputRef.current?.focus());
    },
    [setActiveSession],
  );

  const handleMobileSelectSession = useCallback(
    (sessionId: string) => {
      setActiveSession(sessionId);
      setIsMobileSessionsOpen(false);
      requestAnimationFrame(() => promptInputRef.current?.focus());
    },
    [setActiveSession],
  );

  const handleMobileCreateSession = useCallback(() => {
    if (!activeWorkspaceId) return;
    createSession(activeWorkspaceId);
    setIsMobileSessionsOpen(false);
  }, [activeWorkspaceId, createSession]);

  const handleSelectUnifiedSession = useCallback(
    (sessionId: string, workspaceId: string) => {
      const ws = allWorkspaces.find((w) => w.id === workspaceId);
      const isSleeping = ws && !shouldSSEConnect(ws, activeWorkspaceId);

      useWorkspaceStore.getState().setActiveWorkspaceId(workspaceId);
      setActiveWorkspaceId(workspaceId);
      setActiveSession(sessionId);
      setIsMobileSessionsOpen(false);
      requestAnimationFrame(() => promptInputRef.current?.focus());

      if (isSleeping) {
        toast("Waking workspace…", {
          description: "This may take a few seconds",
        });
        fetchSessions(workspaceId);
      }
    },
    [allWorkspaces, activeWorkspaceId, setActiveWorkspaceId, setActiveSession, fetchSessions],
  );

  const handleToggleUnifiedMode = useCallback(() => {
    setIsUnifiedMode((prev) => {
      const next = !prev;
      localStorage.setItem("dev-hub:chat-unified-mode", String(next));
      if (next) {
        for (const ws of allWorkspaces) {
          if (shouldSSEConnect(ws, activeWorkspaceId)) {
            fetchSessions(ws.id);
          } else {
            fetchCachedSessions(ws.id);
          }
        }
      }
      return next;
    });
  }, [allWorkspaces, activeWorkspaceId, fetchSessions, fetchCachedSessions]);

  const handleToggleGroupByWorkspace = useCallback(() => {
    setGroupByWorkspace((prev) => {
      const next = !prev;
      localStorage.setItem("dev-hub:chat-group-by-workspace", String(next));
      return next;
    });
  }, []);

  const handleWakeWorkspace = useCallback(
    (workspaceId: string) => {
      useWorkspaceStore.getState().setActiveWorkspaceId(workspaceId);
      setActiveWorkspaceId(workspaceId);
      toast("Waking workspace…", {
        description: "This may take a few seconds",
      });
      fetchSessions(workspaceId);
    },
    [setActiveWorkspaceId, fetchSessions],
  );

  const handleWorkspaceOrderChange = useCallback((order: string[]) => {
    setWorkspaceOrder(order);
    localStorage.setItem("dev-hub:chat-workspace-order", JSON.stringify(order));
  }, []);

  const handleToggleWorkspaceExpanded = useCallback((workspaceId: string) => {
    setExpandedWorkspaces((prev) => {
      const next = { ...prev, [workspaceId]: !prev[workspaceId] };
      localStorage.setItem("dev-hub:chat-expanded-workspaces", JSON.stringify(next));
      return next;
    });
  }, []);

  const handlePinSession = useCallback(
    (sessionId: string, workspaceId?: string) => {
      const wsId = workspaceId ?? activeWorkspaceId;
      if (!wsId) return;
      pinSession(sessionId, wsId);
    },
    [activeWorkspaceId, pinSession],
  );

  const handleUnpinSession = useCallback(
    (sessionId: string, workspaceId?: string) => {
      const wsId = workspaceId ?? activeWorkspaceId;
      if (!wsId) return;
      unpinSession(sessionId, wsId);
    },
    [activeWorkspaceId, unpinSession],
  );

  // Use refs so command closures stay stable but always call latest handlers
  const handleCreateSessionRef = useRef(handleCreateSession);
  handleCreateSessionRef.current = handleCreateSession;
  const setIsPlanPanelOpenRef = useRef(setIsPlanPanelOpen);
  setIsPlanPanelOpenRef.current = setIsPlanPanelOpen;
  const setIsSessionListOpenRef = useRef(setIsSessionListOpen);
  setIsSessionListOpenRef.current = setIsSessionListOpen;
  const setIsModelSelectorOpenRef = useRef(setIsModelSelectorOpen);
  setIsModelSelectorOpenRef.current = setIsModelSelectorOpen;
  const setIsAgentSelectorOpenRef = useRef(setIsAgentSelectorOpen);
  setIsAgentSelectorOpenRef.current = setIsAgentSelectorOpen;
  const setIsTaskPanelOpenRef = useRef(setIsTaskPanelOpen);
  setIsTaskPanelOpenRef.current = setIsTaskPanelOpen;
  const [isVariantSelectorOpen, setIsVariantSelectorOpen] = useState(false);
  const setIsVariantSelectorOpenRef = useRef(setIsVariantSelectorOpen);
  setIsVariantSelectorOpenRef.current = setIsVariantSelectorOpen;
  const setShowThinkingRef = useRef(setShowThinking);
  setShowThinkingRef.current = setShowThinking;
  const setShowToolCallsRef = useRef(setShowToolCalls);
  setShowToolCallsRef.current = setShowToolCalls;
  const setShowTokensRef = useRef(setShowTokens);
  setShowTokensRef.current = setShowTokens;
  const setShowTimestampsRef = useRef(setShowTimestamps);
  setShowTimestampsRef.current = setShowTimestamps;

  const toggleThinking = useCallback(() => {
    setShowThinkingRef.current((prev) => {
      const next = !prev;
      localStorage.setItem("dev-hub:chat-show-thinking", String(next));
      return next;
    });
  }, []);

  const toggleToolCalls = useCallback(() => {
    setShowToolCallsRef.current((prev) => {
      const next = !prev;
      localStorage.setItem("dev-hub:chat-show-tool-calls", String(next));
      return next;
    });
  }, []);

  const toggleTokens = useCallback(() => {
    setShowTokensRef.current((prev) => {
      const next = !prev;
      localStorage.setItem("dev-hub:chat-show-tokens", String(next));
      return next;
    });
  }, []);

  const toggleTimestamps = useCallback(() => {
    setShowTimestampsRef.current((prev) => {
      const next = !prev;
      localStorage.setItem("dev-hub:chat-show-timestamps", String(next));
      return next;
    });
  }, []);

  // Session list j/k navigation: build flat list of visible session IDs in render order
  const COLLAPSED_SESSION_LIMIT = 3
  const visibleSessionIds = useMemo<string[]>(() => {
    if (isUnifiedMode && groupByWorkspace) {
      // Replicate groupedSessions logic from SessionList
      const allWsIds = workspaceOptions.map((ws) => ws.id)
      const groups = new Map<string, SessionWithWorkspace[]>()
      for (const id of allWsIds) groups.set(id, [])
      for (const session of unifiedSessions) {
        const existing = groups.get(session.workspaceId)
        if (existing) {
          existing.push(session)
        } else {
          groups.set(session.workspaceId, [session])
        }
      }
      const entries = [...groups.entries()]
      if (workspaceOrder.length > 0) {
        const orderIndex = new Map(workspaceOrder.map((id, i) => [id, i]))
        entries.sort((a, b) => {
          const ai = orderIndex.get(a[0]) ?? Infinity
          const bi = orderIndex.get(b[0]) ?? Infinity
          if (ai !== Infinity || bi !== Infinity) return ai - bi
          const aTime = a[1][0]?.time.updated ?? 0
          const bTime = b[1][0]?.time.updated ?? 0
          return bTime - aTime
        })
      } else {
        entries.sort(([, a], [, b]) => {
          const aTime = a[0]?.time.updated ?? 0
          const bTime = b[0]?.time.updated ?? 0
          return bTime - aTime
        })
      }
      const ids: string[] = []
      for (const [wsId, wsSessions] of entries) {
        const isExpanded = expandedWorkspaces[wsId] ?? false
        const visible = isExpanded ? wsSessions : wsSessions.slice(0, COLLAPSED_SESSION_LIMIT)
        for (const s of visible) ids.push(s.id)
      }
      return ids
    }
    if (isUnifiedMode) {
      return unifiedSessions.map((s) => s.id)
    }
    // Workspace mode
    return Object.values(sessions)
      .filter((s) => !s.parentID)
      .sort((a, b) => b.time.updated - a.time.updated)
      .map((s) => s.id)
  }, [isUnifiedMode, groupByWorkspace, sessions, unifiedSessions, workspaceOptions, workspaceOrder, expandedWorkspaces])

  const visibleSessionIdsRef = useRef(visibleSessionIds)
  visibleSessionIdsRef.current = visibleSessionIds
  const activeSessionIdForNavRef = useRef(activeSessionId)
  activeSessionIdForNavRef.current = activeSessionId

  const selectSessionByIdRef = useRef((sessionId: string) => {
    if (isUnifiedMode) {
      const session = unifiedSessions.find((s) => s.id === sessionId)
      if (session) handleSelectUnifiedSession(sessionId, session.workspaceId)
    } else {
      handleSelectSession(sessionId)
    }
  })
  selectSessionByIdRef.current = (sessionId: string) => {
    if (isUnifiedMode) {
      const session = unifiedSessions.find((s) => s.id === sessionId)
      if (session) handleSelectUnifiedSession(sessionId, session.workspaceId)
    } else {
      handleSelectSession(sessionId)
    }
  }

  const chatCommands = useMemo(
    () => [
      {
        id: "chat:toggle-plan-panel",
        label: isPlanPanelOpen ? "Hide Plan Panel" : "Show Plan Panel",
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
      {
        id: "chat:toggle-task-panel",
        label: isTaskPanelOpen ? "Hide Side Panel" : "Show Side Panel",
        group: "Chat",
        icon: ListTodo,
        onSelect: () => setIsTaskPanelOpenRef.current((prev) => {
          const next = !prev;
          localStorage.setItem("dev-hub:chat-task-panel", String(next));
          return next;
        }),
      },
      {
        id: "chat:toggle-thinking",
        label: showThinking ? "Hide Thinking" : "Show Thinking",
        group: "Chat",
        icon: Brain,
        onSelect: toggleThinking,
      },
      {
        id: "chat:toggle-tool-calls",
        label: showToolCalls ? "Hide Tool Calls" : "Show Tool Calls",
        group: "Chat",
        icon: Wrench,
        onSelect: toggleToolCalls,
      },
      {
        id: "chat:toggle-tokens",
        label: showTokens ? "Hide Token Usage" : "Show Token Usage",
        group: "Chat",
        icon: Coins,
        onSelect: toggleTokens,
      },
      {
        id: "chat:toggle-timestamps",
        label: showTimestamps ? "Hide Timestamps" : "Show Timestamps",
        group: "Chat",
        icon: Clock,
        onSelect: toggleTimestamps,
      },
    ],
    [toggleThinking, toggleToolCalls, toggleTokens, toggleTimestamps, showThinking, showToolCalls, showTokens, showTimestamps, isPlanPanelOpen, isTaskPanelOpen],
  );

  useCommand(chatCommands);

  const chatLeaderActions = useMemo(
    () => {
      const actions = [
        {
          action: {
            id: "chat:switch-model",
            label: "Switch model",
            page: "chat" as const,
          },
          handler: () => setIsModelSelectorOpenRef.current(true),
        },
        {
          action: {
            id: "chat:switch-agent",
            label: "Switch agent",
            page: "chat" as const,
          },
          handler: () => setIsAgentSelectorOpenRef.current(true),
        },
        {
          action: {
            id: "chat:new-session",
            label: "New session",
            page: "chat" as const,
          },
          handler: () => handleCreateSessionRef.current(),
        },
        {
          action: {
            id: "chat:toggle-sessions",
            label: "Toggle session list",
            page: "chat" as const,
          },
          handler: () => setIsSessionListOpenRef.current((prev) => !prev),
        },
        {
          action: {
            id: "chat:toggle-plan",
            label: "Toggle plan panel",
            page: "chat" as const,
          },
          handler: () => setIsPlanPanelOpenRef.current((prev) => !prev),
        },
        {
          action: {
            id: "chat:toggle-tasks",
            label: "Toggle side panel",
            page: "chat" as const,
          },
          handler: () => setIsTaskPanelOpenRef.current((prev) => {
            const next = !prev;
            localStorage.setItem("dev-hub:chat-task-panel", String(next));
            return next;
          }),
        },
        {
          action: {
            id: "chat:toggle-thinking",
            label: "Toggle thinking",
            page: "chat" as const,
          },
          handler: toggleThinking,
        },
        {
          action: {
            id: "chat:toggle-tool-calls",
            label: "Toggle tool calls",
            page: "chat" as const,
          },
          handler: toggleToolCalls,
        },
        {
          action: {
            id: "chat:toggle-tokens",
            label: "Toggle token usage",
            page: "chat" as const,
          },
          handler: toggleTokens,
        },
        {
          action: {
            id: "chat:toggle-timestamps",
            label: "Toggle timestamps",
            page: "chat" as const,
          },
          handler: toggleTimestamps,
        },
        {
          action: {
            id: "chat:focus-prompt",
            label: "Focus prompt input",
            page: "chat" as const,
          },
          handler: () => promptInputRef.current?.focus(),
        },
        {
          action: {
            id: "chat:toggle-variant",
            label: "Toggle variant selector",
            page: "chat" as const,
          },
          handler: () => setIsVariantSelectorOpenRef.current((prev) => !prev),
        },
      ];

      return actions;
    },
    [toggleThinking, toggleToolCalls, toggleTokens, toggleTimestamps],
  );

  useLeaderAction(chatLeaderActions);

  // Tab / Shift+Tab cycles through agents
  const primaryAgentsRef = useRef(orderedAgents);
  primaryAgentsRef.current = orderedAgents;
  const selectedAgentRef = useRef(selectedAgent);
  selectedAgentRef.current = selectedAgent;
  const setSelectedAgentRef = useRef(setSelectedAgent);
  setSelectedAgentRef.current = setSelectedAgent;
  const setSessionAgentRef = useRef(setSessionAgent);
  setSessionAgentRef.current = setSessionAgent;
  const activeSessionIdRef = useRef(activeSessionId);
  activeSessionIdRef.current = activeSessionId;
  const activeWorkspaceIdRef = useRef(activeWorkspaceId);
  activeWorkspaceIdRef.current = activeWorkspaceId;

  const handleModelChange = useCallback((model: SelectedModel) => {
    setSelectedModel(model);
    const sid = activeSessionIdRef.current;
    const wid = activeWorkspaceIdRef.current;
    if (sid && wid) {
      setSessionModel(sid, wid, model);
    }
  }, [setSessionModel]);

  useEffect(() => {
    const handleTabCycle = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const agents = primaryAgentsRef.current;
      if (agents.length < 2) return;

      // Only cycle when focus is inside the chat interface (not in popovers/modals)
      const target = e.target as HTMLElement | null;
      const inChat = target?.closest("[data-chat-interface]");
      if (!inChat) return;

      e.preventDefault();

      const currentIdx = agents.findIndex(
        (a) => a.name === selectedAgentRef.current,
      );
      const nextIdx = e.shiftKey
        ? (currentIdx - 1 + agents.length) % agents.length
        : (currentIdx + 1) % agents.length;
      const nextAgent = agents[nextIdx].name;

      setSelectedAgentRef.current(nextAgent);
      const sessionId = activeSessionIdRef.current;
      const workspaceId = activeWorkspaceIdRef.current;
      if (sessionId && workspaceId) {
        setSessionAgentRef.current(sessionId, workspaceId, nextAgent);
      }
    };

    window.addEventListener("keydown", handleTabCycle);
    return () => window.removeEventListener("keydown", handleTabCycle);
  }, []);

  if (!activeWorkspaceId) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <AlertCircle className="size-12 text-muted-foreground/50" />
        <h3 className="text-lg font-medium">No workspace selected</h3>
        <p className="max-w-md text-sm text-muted-foreground">
          Select a workspace from the sidebar to start chatting with OpenCode.
        </p>
      </div>
    );
  }

  return (
    <div data-chat-interface className="flex h-full min-h-0 min-w-0 w-full">
      {/* Mobile session sheet */}
      <Sheet open={isMobileSessionsOpen} onOpenChange={setIsMobileSessionsOpen}>
        <SheetContent side="left" className="w-72 p-0" showCloseButton={false}>
          <SheetHeader className="sr-only">
            <SheetTitle>Sessions</SheetTitle>
          </SheetHeader>
          {isUnifiedMode ? (
            <SessionList
              mode="unified"
              sessions={unifiedSessions}
              workspaceNames={workspaceNames}
              workspaceBranches={workspaceBranches}
              workspaceColors={workspaceColors}
              hasMore={hasMoreUnifiedSessions}
              onLoadMore={() => setUnifiedLimit((n) => n + 20)}
              workspaces={workspaceOptions}
              activeWorkspaceId={activeWorkspaceId}
              onCreateSessionInWorkspace={handleCreateSessionInWorkspace}
              activeSessionId={activeSessionId}
              sessionStatuses={sessionStatuses}
              questionSessionIds={questionSessionIds}
              lastViewedAt={lastViewedAt}
              isLoading={isSessionsLoading}
              pinnedSessionIds={pinnedSessionIds}
              onSelectSession={handleSelectUnifiedSession}
              onCreateSession={handleMobileCreateSession}
              onDeleteSession={handleDeleteSession}
              onPinSession={handlePinSession}
              onUnpinSession={handleUnpinSession}
              isUnifiedMode={isUnifiedMode}
              onToggleMode={handleToggleUnifiedMode}
              groupByWorkspace={groupByWorkspace}
              onToggleGroupByWorkspace={handleToggleGroupByWorkspace}
              workspaceOrder={workspaceOrder}
              onWorkspaceOrderChange={handleWorkspaceOrderChange}
              expandedWorkspaces={expandedWorkspaces}
              onToggleWorkspaceExpanded={handleToggleWorkspaceExpanded}
              onWakeWorkspace={handleWakeWorkspace}
              sleepingWorkspaceIds={sleepingWorkspaceIds}
            />
          ) : (
            <SessionList
              mode="workspace"
              sessions={sessions}
              workspaceColor={activeWorkspaceColor}
              activeSessionId={activeSessionId}
              sessionStatuses={sessionStatuses}
              questionSessionIds={questionSessionIds}
              lastViewedAt={lastViewedAt}
              pinnedSessionIds={pinnedSessionIds}
              isLoading={isSessionsLoading}
              onSelectSession={handleMobileSelectSession}
              onCreateSession={handleMobileCreateSession}
              onDeleteSession={handleDeleteSession}
              onPinSession={handlePinSession}
              onUnpinSession={handleUnpinSession}
              isUnifiedMode={isUnifiedMode}
              onToggleMode={handleToggleUnifiedMode}
            />
          )}
        </SheetContent>
      </Sheet>

      {/* Session sidebar — hidden on mobile by default */}
      {isSessionListOpen && (
        <>
          <div
            ref={(el) => { sessionListFocusRef.current = el }}
            tabIndex={-1}
            className="hidden shrink-0 overflow-hidden md:block relative"
            style={{ width: sessionListWidth }}
          >
            {isUnifiedMode ? (
              <SessionList
                mode="unified"
                sessions={unifiedSessions}
                workspaceNames={workspaceNames}
                workspaceBranches={workspaceBranches}
                workspaceColors={workspaceColors}
                hasMore={hasMoreUnifiedSessions}
                onLoadMore={() => setUnifiedLimit((n) => n + 20)}
                workspaces={workspaceOptions}
                activeWorkspaceId={activeWorkspaceId}
                onCreateSessionInWorkspace={handleCreateSessionInWorkspace}
                activeSessionId={activeSessionId}
                sessionStatuses={sessionStatuses}
              questionSessionIds={questionSessionIds}
              lastViewedAt={lastViewedAt}
                isLoading={isSessionsLoading}
                pinnedSessionIds={pinnedSessionIds}
                onSelectSession={handleSelectUnifiedSession}
                onCreateSession={handleCreateSession}
                onDeleteSession={handleDeleteSession}
                onPinSession={handlePinSession}
                onUnpinSession={handleUnpinSession}
                isUnifiedMode={isUnifiedMode}
                onToggleMode={handleToggleUnifiedMode}
                groupByWorkspace={groupByWorkspace}
                onToggleGroupByWorkspace={handleToggleGroupByWorkspace}
                workspaceOrder={workspaceOrder}
                onWorkspaceOrderChange={handleWorkspaceOrderChange}
                expandedWorkspaces={expandedWorkspaces}
                onToggleWorkspaceExpanded={handleToggleWorkspaceExpanded}
                onWakeWorkspace={handleWakeWorkspace}
                sleepingWorkspaceIds={sleepingWorkspaceIds}
              />
            ) : (
              <SessionList
                mode="workspace"
                sessions={sessions}
                workspaceColor={activeWorkspaceColor}
                activeSessionId={activeSessionId}
                sessionStatuses={sessionStatuses}
              questionSessionIds={questionSessionIds}
                lastViewedAt={lastViewedAt}
                pinnedSessionIds={pinnedSessionIds}
                isLoading={isSessionsLoading}
                onSelectSession={handleSelectSession}
                onCreateSession={handleCreateSession}
                onDeleteSession={handleDeleteSession}
                onPinSession={handlePinSession}
                onUnpinSession={handleUnpinSession}
                isUnifiedMode={isUnifiedMode}
                onToggleMode={handleToggleUnifiedMode}
              />
            )}
          </div>
          <div
            className="hidden w-1.5 shrink-0 cursor-col-resize items-center justify-center hover:bg-accent/50 active:bg-accent transition-colors md:flex"
            onMouseDown={handleSessionListDragStart}
          >
            <GripVertical className="size-3.5 text-muted-foreground/30" />
          </div>
        </>
      )}

      {/* Main chat area */}
      <ChatDisplayContext.Provider value={chatDisplaySettings}>
      <div
        ref={(el) => { messagesPanelFocusRef.current = el }}
        tabIndex={-1}
        className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
      >
        {/* Chat toolbar */}
        <div className="sticky top-0 z-30 flex shrink-0 items-center gap-1.5 border-b bg-background px-3 py-2 md:gap-2 md:px-4">
          {/* Mobile: open session sheet */}
          <Button
            size="icon-xs"
            variant="ghost"
            onClick={() => setIsMobileSessionsOpen(true)}
            className="mr-1 md:hidden"
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

          <div className="md:flex-1" />

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
            onAgentChange={(agent) => {
              setSelectedAgent(agent);
              if (activeSessionId && activeWorkspaceId) {
                setSessionAgent(activeSessionId, activeWorkspaceId, agent);
                clearSessionModel(activeSessionId, activeWorkspaceId);
              }
            }}
            open={isAgentSelectorOpen}
            onOpenChange={setIsAgentSelectorOpen}
          />

          <ModelSelector
            workspaceId={activeWorkspaceId}
            selectedModel={selectedModel}
            onModelChange={handleModelChange}
            onVariantsChange={setAvailableVariants}
            open={isModelSelectorOpen}
            onOpenChange={setIsModelSelectorOpen}
          />

          <VariantSelector
            variants={availableVariants}
            selectedVariant={selectedVariant}
            onVariantChange={setSelectedVariant}
            open={isVariantSelectorOpen}
            onOpenChange={setIsVariantSelectorOpen}
          />
        </div>

        {/* Messages area or plan panel — mutually exclusive */}
        <div className="chat-scroll-area relative min-h-0 min-w-0 flex-1 overflow-hidden [contain:strict]">
          {isPlanPanelOpen && activeWorkspaceId ? (
            <PlanPanel
              workspaceId={activeWorkspaceId}
              workspaceName={activeWorkspaceName}
              sessionDirectory={activeSessionDirectory}
              isOpen={isPlanPanelOpen}
              onClose={() => setIsPlanPanelOpen(false)}
              onPlanFilesChange={setHasPlanFiles}
            />
          ) : (
            <div className="flex h-full flex-col">
              {activeMessages.length === 0 ? (
                showLoader ? (
                  <div className="flex h-full items-center justify-center">
                    <Loader2 className="size-5 animate-spin text-muted-foreground" />
                  </div>
                ) : !isMessagesLoaded ? (
                  <div className="h-full" />
                ) : (
                  <EmptyChat onSend={handleSendMessage} />
                )
              ) : (
                <Virtuoso
                  key={activeSessionId}
                  ref={virtuosoRef}
                  data={activeMessages}
                  initialTopMostItemIndex={Math.max(
                    0,
                    activeMessages.length - 1,
                  )}
                  itemContent={(index, msg) => {
                    const prev = index > 0 ? activeMessages[index - 1] : null
                    const showAvatar = !prev || prev.info.role !== msg.info.role
                    const canRevert =
                      streamingStatus !== "streaming" &&
                      msg.info.role === "user" &&
                      index > 0
                    return (
                      <ChatMessage
                        key={msg.info.id}
                        message={msg}
                        showAvatar={showAvatar}
                        onRevert={canRevert ? handleRevert : undefined}
                      />
                    )
                  }}
                  followOutput={handleFollowOutput}
                  atBottomStateChange={handleAtBottomStateChange}
                  atBottomThreshold={80}
                  increaseViewportBy={{
                    top: 200,
                    bottom: isMobile ? 100 : 400,
                  }}
                  className="h-full"
                  components={
                    streamingStatus === "streaming"
                      ? STREAMING_COMPONENTS
                      : EMPTY_COMPONENTS
                  }
                />
              )}
            </div>
          )}

          {/* Jump-to-bottom pill — shown when user has scrolled up during streaming or after */}
          {showJumpToBottom &&
            activeMessages.length > 0 &&
            !isPlanPanelOpen && (
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
                  if (!activeWorkspaceId) return;
                  respondToPermission(
                    permission.sessionID,
                    permission.id,
                    response,
                    activeWorkspaceId,
                  );
                }}
              />
            ))}
          </div>
        )}

        {/* Question requests */}
        {activeQuestions.length > 0 && (
          <div className={cn("shrink-0 border-t bg-indigo-500/10 px-4 py-2", !isQuestionsMinimized && "space-y-2")}>
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => setIsQuestionsMinimized((prev) => !prev)}
                className="flex items-center gap-1.5 text-xs font-medium text-indigo-700 dark:text-indigo-300 hover:text-indigo-900 dark:hover:text-indigo-100 transition-colors"
              >
                {isQuestionsMinimized ? (
                  <ChevronRight className="size-3.5" />
                ) : (
                  <ChevronDown className="size-3.5" />
                )}
                <MessageCircleQuestion className="size-3.5" />
                {activeQuestions.length} {activeQuestions.length === 1 ? "question" : "questions"} pending
              </button>
              {!isQuestionsMinimized && (
                <div className="flex rounded-md border border-indigo-500/30 overflow-hidden">
                  <button
                    type="button"
                    onClick={() => {
                      setQuestionViewMode("list");
                      localStorage.setItem("dev-hub:chat-question-view", "list");
                    }}
                    className={cn(
                      "px-1.5 py-1 transition-colors",
                      questionViewMode === "list"
                        ? "bg-indigo-500/20 text-indigo-700 dark:text-indigo-300"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                    )}
                    title="List view"
                  >
                    <LayoutList className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setQuestionViewMode("tabs");
                      localStorage.setItem("dev-hub:chat-question-view", "tabs");
                    }}
                    className={cn(
                      "px-1.5 py-1 transition-colors",
                      questionViewMode === "tabs"
                        ? "bg-indigo-500/20 text-indigo-700 dark:text-indigo-300"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                    )}
                    title="Tab view"
                  >
                    <PanelTop className="size-3.5" />
                  </button>
                </div>
              )}
            </div>
            <div className={cn(
              "grid transition-[grid-template-rows] duration-200 ease-in-out",
              isQuestionsMinimized ? "grid-rows-[0fr]" : "grid-rows-[1fr]"
            )}>
              <div className="overflow-hidden">
                <QuestionErrorBoundary
                  key={activeQuestions.map((q) => q.id).join(",")}
                  onDismissAll={() => {
                    if (!activeWorkspaceId) return;
                    activeQuestions.forEach((q) =>
                      rejectQuestion(q.id, activeWorkspaceId),
                    );
                  }}
                >
                  {activeQuestions.map((question) => (
                    <QuestionBanner
                      key={question.id}
                      request={question}
                      viewMode={questionViewMode}
                      onReply={(answers) => {
                        if (!activeWorkspaceId) return;
                        replyToQuestion(question.id, answers, activeWorkspaceId);
                      }}
                      onReject={() => {
                        if (!activeWorkspaceId) return;
                        rejectQuestion(question.id, activeWorkspaceId);
                      }}
                    />
                  ))}
                </QuestionErrorBoundary>
              </div>
            </div>
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

        <PromptInput
          ref={promptInputRef}
          onSubmit={handleSendMessage}
          onCommandSelect={handleCommandDispatch}
          onAbort={handleAbort}
          isStreaming={streamingStatus === "streaming"}
          disabled={!activeWorkspaceId}
          workspaceId={activeWorkspaceId}
          sessionId={activeSessionId}
          commands={commands}
        />
      </div>
      </ChatDisplayContext.Provider>

      {isTaskPanelOpen && (
        <>
          <div
            className="hidden w-1.5 shrink-0 cursor-col-resize items-center justify-center hover:bg-accent/50 active:bg-accent transition-colors md:flex"
            onMouseDown={handleTaskPanelDragStart}
          >
            <GripVertical className="size-3.5 text-muted-foreground/30" />
          </div>
          <div
            ref={(el) => { taskPanelFocusRef.current = el }}
            tabIndex={-1}
            className="hidden shrink-0 overflow-y-auto border-l md:block relative"
            style={{ width: taskPanelWidth }}
          >
            <div className="flex items-center justify-between border-b px-3 py-2">
              <span className="text-xs font-medium text-muted-foreground">
                {activeTodos.length > 0 ? "Task Progress" : "Side Panel"}
              </span>
              <Button
                size="icon-xs"
                variant="ghost"
                onClick={() => {
                  setIsTaskPanelOpen(false);
                  localStorage.setItem("dev-hub:chat-task-panel", "false");
                }}
              >
                <X className="size-3" />
              </Button>
            </div>
            {activeTodos.length > 0 && (
              <div className="p-3">
                <TaskProgressPanel todos={activeTodos} />
              </div>
            )}
            <div className={activeTodos.length > 0 ? "border-t px-3 py-2" : "px-3 py-2"}>
              <span className="text-xs font-medium text-muted-foreground">MCP Servers</span>
            </div>
            <div className="px-3 pb-3">
              <McpStatusPanel />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

const StreamingIndicator = memo(function StreamingIndicator({
  messages,
  sessionStatus,
}: {
  messages: MessageWithParts[];
  sessionStatus: SessionStatus | null;
}) {
  const label = useMemo(() => {
    // Session-level status takes priority
    if (sessionStatus?.type === "retry") {
      const secondsUntilRetry = Math.max(
        0,
        Math.ceil((sessionStatus.next - Date.now()) / 1000),
      );
      return `Retrying... attempt ${sessionStatus.attempt}${secondsUntilRetry > 0 ? ` · ${secondsUntilRetry}s` : ""}`;
    }

    // Walk parts of the last assistant message to find the most recent activity
    const lastAssistant = [...messages]
      .reverse()
      .find((m) => m.info.role === "assistant");
    if (!lastAssistant) return "Thinking...";

    const { parts } = lastAssistant;

    // Compaction in progress
    const hasCompaction = parts.some((p) => p.type === "compaction");
    if (hasCompaction) return "Compacting context...";

    // Running tool → most informative signal
    const runningTool = [...parts]
      .reverse()
      .find((p) => p.type === "tool" && p.state.status === "running");
    if (runningTool?.type === "tool") {
      return `Running: ${runningTool.state.status === "running" && runningTool.state.title ? runningTool.state.title : runningTool.tool}`;
    }

    // Subtask spawned
    const subtask = [...parts].reverse().find((p) => p.type === "subtask");
    if (subtask?.type === "subtask") {
      return `Subagent: ${subtask.description || subtask.agent}`;
    }

    return "Thinking...";
  }, [messages, sessionStatus]);

  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className="flex gap-1">
        <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/50 [animation-delay:-0.3s]" />
        <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/50 [animation-delay:-0.15s]" />
        <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/50" />
      </div>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
})

const VirtuosoFooter = memo(function VirtuosoFooter() {
  const messages = useChatStore((s) => s.getActiveSessionMessages())
  const sessionStatus = useChatStore((s) => s.getActiveSessionStatus())
  return <StreamingIndicator messages={messages} sessionStatus={sessionStatus} />
})

const VirtuosoSpacer = () => <div className="h-4" />
const EMPTY_COMPONENTS = { Footer: VirtuosoSpacer } as const
const STREAMING_COMPONENTS = { Footer: VirtuosoFooter } as const

function EmptyChat({ onSend }: { onSend: (text: string) => void }) {
  const suggestions = [
    "What files are in this project?",
    "Explain the project structure",
    "Find and fix any bugs",
    "Write tests for the main module",
  ];

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
  );
}

function formatPermissionTitle(permission: string): string {
  return permission.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function PermissionBanner({
  permission,
  onRespond,
}: {
  permission: PermissionRequest;
  onRespond: (response: string) => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-amber-500/50 bg-amber-500/5 px-3 py-2">
      <ShieldAlert className="size-5 shrink-0 text-amber-600" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">
          {formatPermissionTitle(permission.permission)}
        </p>
        {permission.patterns.length > 0 && (
          <p className="text-xs text-muted-foreground truncate">
            {permission.patterns.join(", ")}
          </p>
        )}
      </div>
      <div className="flex gap-1.5 shrink-0">
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
          variant="outline"
          onClick={() => onRespond("allow")}
          className="gap-1"
        >
          <Check className="size-3" />
          Allow
        </Button>
        <Button size="sm" onClick={() => onRespond("always")} className="gap-1">
          <Check className="size-3" />
          Always
        </Button>
      </div>
    </div>
  );
}

function QuestionBanner({
  request,
  viewMode = "list",
  onReply,
  onReject,
}: {
  request: QuestionRequest;
  viewMode?: "list" | "tabs";
  onReply: (answers: QuestionAnswer[]) => void;
  onReject: () => void;
}) {
  const questionList = request.questions ?? [];
  const [activeTab, setActiveTab] = useState(0);

  // One selection state per question in the request
  const [selections, setSelections] = useState<string[][]>(() =>
    questionList.map(() => []),
  );
  const [customInputs, setCustomInputs] = useState<string[]>(() =>
    questionList.map(() => ""),
  );

  const toggleOption = (
    questionIndex: number,
    label: string,
    isMultiple: boolean,
  ) => {
    setSelections((prev) => {
      const next = [...prev];
      const current = next[questionIndex] ?? [];
      if (isMultiple) {
        next[questionIndex] = current.includes(label)
          ? current.filter((l) => l !== label)
          : [...current, label];
      } else {
        next[questionIndex] = current.includes(label) ? [] : [label];
      }
      return next;
    });
  };

  const handleSubmit = () => {
    const answers: QuestionAnswer[] = questionList.map((q, i) => {
      const selected = selections[i];
      const custom = customInputs[i].trim();
      if (custom && selected.length === 0) return [custom];
      if (custom) return [...selected, custom];
      return selected;
    });
    onReply(answers);
  };

  const hasAnySelection =
    selections.some((s) => s.length > 0) ||
    customInputs.some((c) => c.trim().length > 0);

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey && hasAnySelection) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const useTabs = viewMode === "tabs" && questionList.length > 1;

  return (
    <div className="rounded-lg border border-indigo-500/50 bg-indigo-500/5 px-3 py-2 space-y-3">
      {useTabs ? (
        <>
          <div className="flex gap-1 overflow-x-auto border-b border-indigo-500/20 -mx-3 px-3">
            {questionList.map((q, i) => {
              const hasSelection =
                (selections[i]?.length ?? 0) > 0 ||
                (customInputs[i]?.trim().length ?? 0) > 0;
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => setActiveTab(i)}
                  className={cn(
                    "shrink-0 px-3 py-1.5 text-xs font-medium border-b-2 -mb-px transition-colors",
                    activeTab === i
                      ? "border-indigo-500 text-indigo-700 dark:text-indigo-300"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  )}
                >
                  {q.header}
                  {hasSelection && (
                    <span className="ml-1.5 inline-block size-1.5 rounded-full bg-indigo-500" />
                  )}
                </button>
              );
            })}
          </div>
          <QuestionItem
            question={questionList[activeTab]}
            selected={selections[activeTab]}
            customInput={customInputs[activeTab]}
            onToggleOption={(label) =>
              toggleOption(activeTab, label, questionList[activeTab].multiple === true)
            }
            onCustomInputChange={(value) => {
              setCustomInputs((prev) => {
                const next = [...prev];
                next[activeTab] = value;
                return next;
              });
            }}
            onSubmitOnEnter={handleInputKeyDown}
          />
        </>
      ) : (
        questionList.map((q, questionIndex) => (
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
                const next = [...prev];
                next[questionIndex] = value;
                return next;
              });
            }}
            onSubmitOnEnter={handleInputKeyDown}
          />
        ))
      )}
      <div className="flex justify-end gap-1.5">
        <Button
          size="sm"
          variant="outline"
          onClick={onReject}
          className="gap-1"
        >
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
  );
}

function QuestionItem({
  question,
  selected,
  customInput,
  onToggleOption,
  onCustomInputChange,
  onSubmitOnEnter,
}: {
  question: QuestionInfo;
  selected: string[];
  customInput: string;
  onToggleOption: (label: string) => void;
  onCustomInputChange: (value: string) => void;
  onSubmitOnEnter: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}) {
  const allowCustom = question.custom !== false;
  const options = question.options ?? [];

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
            const isSelected = selected.includes(option.label);
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
            );
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
  );
}

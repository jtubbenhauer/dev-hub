"use client";

import { useAgentModelSync } from "@/components/chat/use-agent-model-sync";
import type { SlashCommand } from "@/components/chat/command-picker";
import { ChatDisplayContext } from "@/components/chat/chat-display-context";
import { EmptyChat } from "@/components/chat/empty-chat";
import { ChatMessage, isMessageVisible } from "@/components/chat/message";
import { loadPersistedModel } from "@/components/chat/model-selector";
import { PermissionBanner } from "@/components/chat/permission-banner";
import { PlanPanel } from "@/components/chat/plan-panel";
import type { PromptInputHandle } from "@/components/chat/prompt-input";
import { PromptInput } from "@/components/chat/prompt-input";
import {
  QuestionBanner,
  QuestionErrorBoundary,
} from "@/components/chat/question-banner";
import { SessionList } from "@/components/chat/session-list";
import {
  EMPTY_COMPONENTS,
  STREAMING_COMPONENTS,
} from "@/components/chat/streaming-indicator";
import { useChatCommands } from "@/components/chat/use-chat-commands";
import { useChatEffects } from "@/components/chat/use-chat-effects";
import { useSessionManagement } from "@/components/chat/use-session-management";
import { useSessionNavigation } from "@/components/chat/use-session-navigation";
import { TaskProgressPanel } from "@/components/chat/task-progress";
import { McpStatusPanel } from "@/components/chat/mcp-status";
import { SessionFilesPanel } from "@/components/chat/session-files-panel";
import { WorkspaceContextPanel } from "@/components/chat/workspace-context-panel";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { shouldSSEConnect } from "@/lib/workspaces/behaviour";
import { useAgentHealth, useGitStatus } from "@/hooks/use-git";
import { useIsMobile } from "@/hooks/use-mobile";
import { useResizablePanel } from "@/hooks/use-resizable-panel";

import type { Command } from "@/lib/opencode/types";
import { useChatStore } from "@/stores/chat-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useQueries } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowDown,
  ChevronDown,
  ChevronRight,
  GitBranch,
  GripVertical,
  LayoutList,
  Loader2,
  MessageCircleQuestion,
  MessageSquare,
  PanelRight,
  PanelTop,
  Plus,
  ScrollText,
  StickyNote,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { VirtuosoHandle } from "react-virtuoso";
import { Virtuoso } from "react-virtuoso";

interface SelectedModel {
  providerID: string;
  modelID: string;
}

const EMPTY_LAST_VIEWED: Record<string, number> = {};

export function ChatInterface() {
  const [selectedModel, setSelectedModel] = useState<SelectedModel | null>(() =>
    loadPersistedModel(),
  );
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [selectedVariant, setSelectedVariant] = useState<string | null>(null);
  const [availableVariants, setAvailableVariants] = useState<string[]>([]);
  const [isSessionListOpen, setIsSessionListOpen] = useState(true);
  const [questionViewMode, setQuestionViewMode] = useState<"list" | "tabs">(
    () => {
      if (typeof window === "undefined") return "list";
      const stored = localStorage.getItem("dev-hub:chat-question-view");
      return stored === "tabs" ? "tabs" : "list";
    },
  );
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
  const { width: taskPanelWidth, handleDragStart: handleTaskPanelDragStart } =
    useResizablePanel({
      minWidth: 200,
      maxWidth: 400,
      defaultWidth: 280,
      storageKey: "dev-hub:chat-task-panel-width",
      reverse: true,
    });
  const [isPlanPanelOpen, setIsPlanPanelOpen] = useState(false);
  const [, setHasPlanFiles] = useState(false);
  const [isMobileRightPanelOpen, setIsMobileRightPanelOpen] = useState(false);
  const [isEditingSessionNote, setIsEditingSessionNote] = useState(false);
  const [sessionNoteValue, setSessionNoteValue] = useState("");
  const sessionNoteInputRef = useRef<HTMLInputElement>(null);
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
  const activeWorkspacePath = useWorkspaceStore(
    (state) => state.activeWorkspace?.path ?? "",
  );
  const allWorkspaces = useWorkspaceStore((state) => state.workspaces);

  const activeWorkspace = useMemo(
    () => allWorkspaces.find((w) => w.id === activeWorkspaceId) ?? null,
    [allWorkspaces, activeWorkspaceId],
  );

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

  const activeSessionId = useChatStore((s) => s.activeSessionId);

  const { orderedAgents, primaryAgents } = useAgentModelSync({
    activeWorkspaceId,
    activeSessionId,
    selectedAgent,
    setSelectedAgent,
    selectedModel,
    setSelectedModel,
    selectedVariant,
    availableVariants,
    setSelectedVariant,
  });

  const streamingError = useChatStore((s) => s.streamingError);

  const {
    createSession,
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
    getActivePermissions,
    getActiveQuestions,
    getActiveSessionStatuses,
    getStreamingStatus,
    getActiveTodos,
    getUnifiedSessionStatuses,
    getActiveQuestionSessionIds,
    getUnifiedQuestionSessionIds,
    getUnifiedLastViewedAt,
    getUnifiedPinnedSessionIds,
    getActivePinnedSessionIds,
    getActiveSessionNotes,
    getUnifiedSessionNotes,
    clearSessionNote,
    setSessionAgent,
    clearSessionModel,
    setSessionVariant,
  } = useChatStore.getState();

  // getStreamingStatus must be passed as a stable reference — inline lambdas like
  // `(s) => s.getStreamingStatus()` create a new function each render, which causes
  // useSyncExternalStore to see a "new snapshot" every tick → infinite re-render loop.
  const streamingStatus = useChatStore(getStreamingStatus);
  const isMobile = useIsMobile();
  const isActiveWorkspaceRemote = activeWorkspace?.backend === "remote";
  const { data: healthStatus } = useAgentHealth(
    activeWorkspaceId,
    isActiveWorkspaceRemote,
  );

  const {
    isUnifiedMode,
    groupByWorkspace,
    workspaceOrder,
    expandedWorkspaces,
    isMobileSessionsOpen,
    setIsMobileSessionsOpen,
    handleCreateSession,
    handleCreateSessionInWorkspace,
    handleDeleteSession,
    handleSelectSession,
    handleMobileSelectSession,
    handleMobileCreateSession,
    handleSelectUnifiedSession,
    handleToggleUnifiedMode,
    handleToggleGroupByWorkspace,
    handleWakeWorkspace,
    handleWorkspaceOrderChange,
    handleToggleWorkspaceExpanded,
    handlePinSession,
    handleUnpinSession,
    handleSetSessionNote,
    handleClearSessionNote,
  } = useSessionManagement({
    activeWorkspaceId,
    allWorkspaces,
    healthStatus,
    promptInputRef,
  });

  const branchQueryResults = useQueries({
    queries: allWorkspaces.map((ws) => ({
      queryKey: ["git-status", ws.id],
      queryFn: async () => {
        const params = new URLSearchParams({ action: "status" });
        const res = await fetch(`/api/workspaces/${ws.id}/git?${params}`);
        if (!res.ok) return null;
        return res.json() as Promise<{ branch: string }>;
      },
      enabled: isUnifiedMode,
      staleTime: 30_000,
      retry: false,
    })),
  });

  const workspaceBranches = useMemo(() => {
    const map: Record<string, string> = {};
    for (let i = 0; i < allWorkspaces.length; i++) {
      const data = branchQueryResults[i]?.data;
      if (data?.branch) {
        map[allWorkspaces[i].id] = data.branch;
      }
    }
    return map;
  }, [allWorkspaces, branchQueryResults]);

  const sessions = useChatStore(getActiveWorkspaceSessions);
  const activeSessionDirectory = activeSessionId
    ? sessions[activeSessionId]?.directory
    : undefined;
  const activeSessionTitle = activeSessionId
    ? (sessions[activeSessionId]?.title ?? "")
    : "";
  const { data: gitStatus } = useGitStatus(activeWorkspaceId);
  const [unifiedLimit, setUnifiedLimit] = useState(20);
  // In grouped mode, we still cap per-workspace to avoid sorting thousands of sessions.
  // WorkspaceGroup already collapses to ~3 visible per group, so 50 per workspace is generous.
  const MAX_GROUPED_PER_WORKSPACE = 50;
  const effectiveUnifiedLimit = groupByWorkspace
    ? allWorkspaces.length * MAX_GROUPED_PER_WORKSPACE
    : unifiedLimit;
  const allUnifiedSessions = useChatStore((state) =>
    state.getRecentSessionsAcrossWorkspaces(effectiveUnifiedLimit),
  );
  const workspaceIds = useMemo(
    () => new Set(allWorkspaces.map((w) => w.id)),
    [allWorkspaces],
  );
  const unifiedSessions = useMemo(
    () => allUnifiedSessions.filter((s) => workspaceIds.has(s.workspaceId)),
    [allUnifiedSessions, workspaceIds],
  );
  const totalUnifiedCount = useChatStore((state) => {
    let count = 0;
    for (const ws of Object.values(state.workspaceStates)) {
      for (const session of Object.values(ws.sessions)) {
        if (!session.parentID) count++;
      }
    }
    return count;
  });
  const hasMoreUnifiedSessions = totalUnifiedCount > unifiedLimit;
  const commands: Command[] = useChatStore((state) => state.commands);
  // getActivePermissions / getActiveQuestions return raw workspace arrays (stable refs).
  // We filter by sessionID here with useMemo so we never create a new array reference
  // on every render — that would violate useSyncExternalStore's snapshot contract and
  // cause "Maximum update depth exceeded" via the ScrollArea ref cascade.
  const allPermissions = useChatStore(getActivePermissions);
  const allQuestions = useChatStore(getActiveQuestions);
  const activeWsSessionStatuses = useChatStore(getActiveSessionStatuses);
  const activeWsLastViewedAt = useChatStore((s) => {
    const wsId = s.activeWorkspaceId;
    if (!wsId) return EMPTY_LAST_VIEWED;
    return s.workspaceStates[wsId]?.lastViewedAt ?? EMPTY_LAST_VIEWED;
  });
  const unifiedStatuses = useChatStore(getUnifiedSessionStatuses);
  const unifiedLastViewed = useChatStore(getUnifiedLastViewedAt);
  const sessionStatuses = isUnifiedMode
    ? unifiedStatuses
    : activeWsSessionStatuses;
  const lastViewedAt = isUnifiedMode ? unifiedLastViewed : activeWsLastViewedAt;
  const activeTodos = useChatStore(getActiveTodos);
  const unifiedPinnedIds = useChatStore(getUnifiedPinnedSessionIds);
  const activePinnedIds = useChatStore(getActivePinnedSessionIds);
  const pinnedSessionIds = isUnifiedMode ? unifiedPinnedIds : activePinnedIds;
  const unifiedSessionNotes = useChatStore(getUnifiedSessionNotes);
  const activeSessionNotes = useChatStore(getActiveSessionNotes);
  const sessionNotes = isUnifiedMode ? unifiedSessionNotes : activeSessionNotes;
  const activeNote = activeSessionId
    ? sessionNotes[activeSessionId]
    : undefined;
  const activeQuestionSessionIds = useChatStore(getActiveQuestionSessionIds);
  const unifiedQuestionSessionIds = useChatStore(getUnifiedQuestionSessionIds);
  const questionSessionIds = isUnifiedMode
    ? unifiedQuestionSessionIds
    : activeQuestionSessionIds;

  const isSessionsLoading = useChatStore((s) => {
    if (isUnifiedMode) {
      return allWorkspaces.some(
        (ws) => !s.workspaceStates[ws.id]?.sessionsLoaded,
      );
    }
    const wsId = s.activeWorkspaceId;
    if (!wsId) return false;
    return !s.workspaceStates[wsId]?.sessionsLoaded;
  });

  const childSessionIds = useMemo(() => {
    if (!activeSessionId) return new Set<string>();
    const childrenOf = new Map<string, string[]>();
    for (const s of Object.values(sessions)) {
      if (s.parentID) {
        const siblings = childrenOf.get(s.parentID) ?? [];
        siblings.push(s.id);
        childrenOf.set(s.parentID, siblings);
      }
    }
    const descendants = new Set<string>();
    const queue = [...(childrenOf.get(activeSessionId) ?? [])];
    while (queue.length > 0) {
      const id = queue.shift()!;
      if (!descendants.has(id)) {
        descendants.add(id);
        queue.push(...(childrenOf.get(id) ?? []));
      }
    }
    return descendants;
  }, [sessions, activeSessionId]);

  const activePermissions = useMemo(
    () =>
      allPermissions.filter(
        (p) =>
          p.sessionID === activeSessionId || childSessionIds.has(p.sessionID),
      ),
    [allPermissions, activeSessionId, childSessionIds],
  );
  const activeQuestions = useMemo(
    () =>
      allQuestions.filter(
        (q) =>
          q.sessionID === activeSessionId || childSessionIds.has(q.sessionID),
      ),
    [allQuestions, activeSessionId, childSessionIds],
  );

  useChatEffects({
    activeWorkspaceId,
    activeSessionId,
    healthStatus,
    isActiveWorkspaceRemote,
  });

  const activeMessagesRaw = useChatStore(getActiveSessionMessages);
  const activeMessages = useMemo(
    () =>
      activeMessagesRaw.filter((m) =>
        isMessageVisible(m, { showThinking, showToolCalls }),
      ),
    [activeMessagesRaw, showThinking, showToolCalls],
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
    setIsEditingSessionNote(false);
  }, [activeSessionId]);

  const handleAtBottomStateChange = useCallback((atBottom: boolean) => {
    setShowJumpToBottom(!atBottom);
  }, []);

  // Snap to bottom instantly during streaming so growing content doesn't undershoot
  const handleFollowOutput = useCallback((isAtBottom: boolean) => {
    return isAtBottom ? ("auto" as const) : (false as const);
  }, []);

  const handleSendMessage = useCallback(
    async (
      text: string,
      attachments?: Array<{
        mime: string;
        dataUrl: string;
        filename: string;
      }>,
    ) => {
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
        attachments,
      );

      if (sessionNotes[sessionId]) {
        clearSessionNote(sessionId, activeWorkspaceId);
      }
    },
    [
      activeWorkspaceId,
      activeSessionId,
      selectedModel,
      selectedAgent,
      selectedVariant,
      createSession,
      sendMessage,
      sessionNotes,
      clearSessionNote,
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
            const compactionAgent = primaryAgents.find(
              (a) => a.name.toLowerCase() === "compaction",
            );
            const compactModel =
              compactionAgent?.model ?? selectedModel ?? undefined;
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

  const handleStartEditSessionNote = useCallback(() => {
    setSessionNoteValue(activeNote ?? "");
    setIsEditingSessionNote(true);
    requestAnimationFrame(() => sessionNoteInputRef.current?.focus());
  }, [activeNote]);

  const handleSaveSessionNote = useCallback(() => {
    if (!activeSessionId || !activeWorkspaceId) {
      setIsEditingSessionNote(false);
      return;
    }
    const trimmed = sessionNoteValue.trim();
    if (trimmed) {
      handleSetSessionNote(activeSessionId, trimmed);
    } else if (activeNote) {
      handleClearSessionNote(activeSessionId);
    }
    setIsEditingSessionNote(false);
  }, [
    activeSessionId,
    activeWorkspaceId,
    sessionNoteValue,
    activeNote,
    handleSetSessionNote,
    handleClearSessionNote,
  ]);

  const handleAbort = useCallback(() => {
    if (!activeSessionId || !activeWorkspaceId) return;
    abortSession(activeSessionId, activeWorkspaceId);
  }, [activeSessionId, activeWorkspaceId, abortSession]);

  const handleRevert = useCallback(
    async (messageId: string) => {
      if (!activeSessionId || !activeWorkspaceId) return;
      const text = await revertSession(
        activeSessionId,
        activeWorkspaceId,
        messageId,
      );
      if (text) {
        promptInputRef.current?.setValue(text);
      }
    },
    [activeSessionId, activeWorkspaceId, revertSession],
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

  const { isVariantSelectorOpen, setIsVariantSelectorOpen } = useChatCommands(
    {
      handleCreateSession: handleCreateSessionRef,
      setIsPlanPanelOpen: setIsPlanPanelOpenRef,
      setIsSessionListOpen: setIsSessionListOpenRef,
      setIsModelSelectorOpen: setIsModelSelectorOpenRef,
      setIsAgentSelectorOpen: setIsAgentSelectorOpenRef,
      setIsTaskPanelOpen: setIsTaskPanelOpenRef,
      promptInput: promptInputRef,
    },
    {
      isPlanPanelOpen,
      isTaskPanelOpen,
      showThinking,
      showToolCalls,
      showTokens,
      showTimestamps,
    },
    {
      setShowThinking,
      setShowToolCalls,
      setShowTokens,
      setShowTimestamps,
    },
  );

  const { handleModelChange } = useSessionNavigation({
    orderedAgents,
    selectedAgent,
    setSelectedAgent,
    activeSessionId,
    activeWorkspaceId,
    setSelectedModel,
  });

  if (!activeWorkspaceId) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <AlertCircle className="text-muted-foreground/50 size-12" />
        <h3 className="text-lg font-medium">No workspace selected</h3>
        <p className="text-muted-foreground max-w-md text-sm">
          Select a workspace from the sidebar to start chatting with OpenCode.
        </p>
      </div>
    );
  }

  const sharedUnifiedProps = {
    mode: "unified" as const,
    sessions: unifiedSessions,
    workspaceNames,
    workspaceBranches,
    workspaceColors,
    hasMore: hasMoreUnifiedSessions,
    onLoadMore: () => setUnifiedLimit((n) => n + 20),
    workspaces: workspaceOptions,
    activeWorkspaceId,
    onCreateSessionInWorkspace: handleCreateSessionInWorkspace,
    activeSessionId,
    sessionStatuses,
    questionSessionIds,
    lastViewedAt,
    isLoading: isSessionsLoading,
    pinnedSessionIds,
    sessionNotes,
    onDeleteSession: handleDeleteSession,
    onPinSession: handlePinSession,
    onUnpinSession: handleUnpinSession,
    onSetSessionNote: handleSetSessionNote,
    onClearSessionNote: handleClearSessionNote,
    isUnifiedMode,
    onToggleMode: handleToggleUnifiedMode,
    groupByWorkspace,
    onToggleGroupByWorkspace: handleToggleGroupByWorkspace,
    workspaceOrder,
    onWorkspaceOrderChange: handleWorkspaceOrderChange,
    expandedWorkspaces,
    onToggleWorkspaceExpanded: handleToggleWorkspaceExpanded,
    onWakeWorkspace: handleWakeWorkspace,
    sleepingWorkspaceIds,
  };

  const sharedWorkspaceProps = {
    mode: "workspace" as const,
    sessions,
    workspaceColor: activeWorkspaceColor,
    activeSessionId,
    sessionStatuses,
    questionSessionIds,
    lastViewedAt,
    pinnedSessionIds,
    sessionNotes,
    isLoading: isSessionsLoading,
    onDeleteSession: handleDeleteSession,
    onPinSession: handlePinSession,
    onUnpinSession: handleUnpinSession,
    onSetSessionNote: handleSetSessionNote,
    onClearSessionNote: handleClearSessionNote,
    isUnifiedMode,
    onToggleMode: handleToggleUnifiedMode,
  };

  return (
    <div data-chat-interface className="flex h-full min-h-0 w-full min-w-0">
      {/* Mobile session sheet */}
      <Sheet open={isMobileSessionsOpen} onOpenChange={setIsMobileSessionsOpen}>
        <SheetContent side="left" className="w-72 p-0" showCloseButton={false}>
          <SheetHeader className="sr-only">
            <SheetTitle>Sessions</SheetTitle>
          </SheetHeader>
          {isUnifiedMode ? (
            <SessionList
              {...sharedUnifiedProps}
              onSelectSession={handleSelectUnifiedSession}
              onCreateSession={handleMobileCreateSession}
            />
          ) : (
            <SessionList
              {...sharedWorkspaceProps}
              onSelectSession={handleMobileSelectSession}
              onCreateSession={handleMobileCreateSession}
            />
          )}
        </SheetContent>
      </Sheet>

      {/* Mobile right panel sheet */}
      <Sheet
        open={isMobileRightPanelOpen}
        onOpenChange={setIsMobileRightPanelOpen}
      >
        <SheetContent side="right" className="w-72 p-0" showCloseButton={false}>
          <SheetHeader className="sr-only">
            <SheetTitle>Side Panel</SheetTitle>
          </SheetHeader>
          <div className="h-full overflow-y-auto">
            {activeWorkspaceId && activeWorkspace && (
              <WorkspaceContextPanel
                workspaceId={activeWorkspaceId}
                workspace={activeWorkspace}
              />
            )}
            {activeTodos.length > 0 && (
              <>
                <div className="border-t px-3 py-2">
                  <span className="text-muted-foreground text-xs font-medium">
                    Task Progress
                  </span>
                </div>
                <div className="px-3 pb-3">
                  <TaskProgressPanel todos={activeTodos} />
                </div>
              </>
            )}
            <div className="border-t px-3 py-2">
              <span className="text-muted-foreground text-xs font-medium">
                MCP Servers
              </span>
            </div>
            <div className="px-3 pb-3">
              <McpStatusPanel />
            </div>
            <div className="border-t px-3 py-2">
              <span className="text-muted-foreground text-xs font-medium">
                Session Files
              </span>
            </div>
            <div className="px-3 pb-3">
              <SessionFilesPanel
                messages={activeMessagesRaw}
                workspacePath={activeWorkspacePath}
              />
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Session sidebar — hidden on mobile by default */}
      {isSessionListOpen && (
        <>
          <div
            ref={(el) => {
              sessionListFocusRef.current = el;
            }}
            tabIndex={-1}
            className="relative hidden shrink-0 overflow-hidden md:block"
            style={{ width: sessionListWidth }}
          >
            {isUnifiedMode ? (
              <SessionList
                {...sharedUnifiedProps}
                onSelectSession={handleSelectUnifiedSession}
                onCreateSession={handleCreateSession}
              />
            ) : (
              <SessionList
                {...sharedWorkspaceProps}
                onSelectSession={handleSelectSession}
                onCreateSession={handleCreateSession}
              />
            )}
          </div>
          <div
            className="hover:bg-accent/50 active:bg-accent hidden w-1.5 shrink-0 cursor-col-resize items-center justify-center transition-colors md:flex"
            onMouseDown={handleSessionListDragStart}
          >
            <GripVertical className="text-muted-foreground/30 size-3.5" />
          </div>
        </>
      )}

      {/* Main chat area */}
      <ChatDisplayContext.Provider value={chatDisplaySettings}>
        <div
          ref={(el) => {
            messagesPanelFocusRef.current = el;
          }}
          tabIndex={-1}
          className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
        >
          {/* Chat toolbar */}
          <div className="bg-background sticky top-0 z-30 flex h-10 shrink-0 items-center gap-1.5 border-b px-3 md:gap-2 md:px-4">
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

            {/* Session info */}
            <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
              {activeSessionTitle ? (
                <span
                  className="text-foreground truncate text-sm font-medium"
                  title={activeSessionTitle}
                >
                  {activeSessionTitle}
                </span>
              ) : activeSessionId ? (
                <span className="text-muted-foreground truncate text-sm italic">
                  Untitled
                </span>
              ) : null}
              {gitStatus?.branch && (
                <span className="text-muted-foreground hidden shrink-0 items-center gap-1 text-xs md:inline-flex">
                  <GitBranch className="size-3" />
                  {gitStatus.branch}
                </span>
              )}
            </div>

            <Button
              size="icon-sm"
              variant={activeNote ? "secondary" : "outline"}
              onClick={handleStartEditSessionNote}
              disabled={!activeSessionId}
              title={activeNote ? "Edit note" : "Add note"}
            >
              <StickyNote
                className={cn("size-4", activeNote && "text-amber-400")}
              />
            </Button>

            <Button
              size="icon-sm"
              variant={isPlanPanelOpen ? "secondary" : "outline"}
              onClick={() => setIsPlanPanelOpen(!isPlanPanelOpen)}
              title="Plan notes"
            >
              <ScrollText className="size-4" />
            </Button>

            <Button
              size="icon-sm"
              variant="outline"
              onClick={async () => {
                if (activeWorkspaceId) {
                  await createSession(activeWorkspaceId);
                }
              }}
              disabled={!activeWorkspaceId}
              title="New session"
            >
              <Plus className="size-4" />
            </Button>

            <Button
              size="icon-sm"
              variant="outline"
              onClick={() => setIsMobileRightPanelOpen(true)}
              title="Side panel"
              className="md:hidden"
            >
              <PanelRight className="size-4" />
            </Button>
          </div>

          {/* Session note banner */}
          {(activeNote || isEditingSessionNote) && (
            <div className="flex shrink-0 items-center gap-2 border-b bg-amber-500/10 px-3 py-1.5 md:px-4">
              <StickyNote className="size-3.5 shrink-0 text-amber-400" />
              {isEditingSessionNote ? (
                <form
                  className="flex min-w-0 flex-1 items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleSaveSessionNote();
                  }}
                >
                  <input
                    ref={sessionNoteInputRef}
                    type="text"
                    className="border-input bg-background text-foreground placeholder:text-muted-foreground min-w-0 flex-1 rounded border px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-amber-500"
                    value={sessionNoteValue}
                    onChange={(e) => setSessionNoteValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        setIsEditingSessionNote(false);
                      }
                    }}
                    onBlur={handleSaveSessionNote}
                    placeholder="Where I'm at / what to do next…"
                  />
                </form>
              ) : (
                <>
                  <span className="min-w-0 flex-1 truncate text-sm text-amber-300/90">
                    {activeNote}
                  </span>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    onClick={handleStartEditSessionNote}
                    title="Edit note"
                  >
                    <StickyNote className="size-3 text-amber-400" />
                  </Button>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    onClick={() => {
                      if (activeSessionId && activeWorkspaceId) {
                        handleClearSessionNote(activeSessionId);
                      }
                    }}
                    title="Dismiss note"
                  >
                    <X className="size-3 text-amber-400/70 hover:text-amber-300" />
                  </Button>
                </>
              )}
            </div>
          )}

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
                      <Loader2 className="text-muted-foreground size-5 animate-spin" />
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
                      const prev = index > 0 ? activeMessages[index - 1] : null;
                      const showAvatar =
                        !prev || prev.info.role !== msg.info.role;
                      const canRevert =
                        streamingStatus !== "streaming" &&
                        msg.info.role === "user" &&
                        index > 0;
                      return (
                        <ChatMessage
                          key={msg.info.id}
                          message={msg}
                          showAvatar={showAvatar}
                          onRevert={canRevert ? handleRevert : undefined}
                        />
                      );
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
                    className="bg-background hover:bg-muted pointer-events-auto flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium shadow-md transition-opacity"
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
            <div
              className={cn(
                "shrink-0 border-t bg-indigo-500/10 px-4 py-2",
                !isQuestionsMinimized && "space-y-2",
              )}
            >
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setIsQuestionsMinimized((prev) => !prev)}
                  className="flex items-center gap-1.5 text-xs font-medium text-indigo-700 transition-colors hover:text-indigo-900 dark:text-indigo-300 dark:hover:text-indigo-100"
                >
                  {isQuestionsMinimized ? (
                    <ChevronRight className="size-3.5" />
                  ) : (
                    <ChevronDown className="size-3.5" />
                  )}
                  <MessageCircleQuestion className="size-3.5" />
                  {activeQuestions.length}{" "}
                  {activeQuestions.length === 1 ? "question" : "questions"}{" "}
                  pending
                </button>
                {!isQuestionsMinimized && (
                  <div className="flex overflow-hidden rounded-md border border-indigo-500/30">
                    <button
                      type="button"
                      onClick={() => {
                        setQuestionViewMode("list");
                        localStorage.setItem(
                          "dev-hub:chat-question-view",
                          "list",
                        );
                      }}
                      className={cn(
                        "px-1.5 py-1 transition-colors",
                        questionViewMode === "list"
                          ? "bg-indigo-500/20 text-indigo-700 dark:text-indigo-300"
                          : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
                      )}
                      title="List view"
                    >
                      <LayoutList className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setQuestionViewMode("tabs");
                        localStorage.setItem(
                          "dev-hub:chat-question-view",
                          "tabs",
                        );
                      }}
                      className={cn(
                        "px-1.5 py-1 transition-colors",
                        questionViewMode === "tabs"
                          ? "bg-indigo-500/20 text-indigo-700 dark:text-indigo-300"
                          : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
                      )}
                      title="Tab view"
                    >
                      <PanelTop className="size-3.5" />
                    </button>
                  </div>
                )}
              </div>
              <div
                className={cn(
                  "grid transition-[grid-template-rows] duration-200 ease-in-out",
                  isQuestionsMinimized ? "grid-rows-[0fr]" : "grid-rows-[1fr]",
                )}
              >
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
                          replyToQuestion(
                            question.id,
                            answers,
                            activeWorkspaceId,
                          );
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
            <div className="bg-destructive/10 text-destructive flex shrink-0 items-center gap-2 border-t px-4 py-2 text-sm">
              <AlertCircle className="size-4 shrink-0" />
              <span className="flex-1">{streamingError}</span>
              <Button
                size="icon-xs"
                variant="ghost"
                className="text-destructive hover:text-destructive shrink-0"
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
            agents={primaryAgents}
            selectedAgent={selectedAgent}
            onAgentChange={(agent) => {
              setSelectedAgent(agent);
              if (activeSessionId && activeWorkspaceId) {
                setSessionAgent(activeSessionId, activeWorkspaceId, agent);
                clearSessionModel(activeSessionId, activeWorkspaceId);
              }
            }}
            isAgentSelectorOpen={isAgentSelectorOpen}
            onAgentSelectorOpenChange={setIsAgentSelectorOpen}
            selectedModel={selectedModel}
            onModelChange={handleModelChange}
            onVariantsChange={setAvailableVariants}
            isModelSelectorOpen={isModelSelectorOpen}
            onModelSelectorOpenChange={setIsModelSelectorOpen}
            availableVariants={availableVariants}
            selectedVariant={selectedVariant}
            onVariantChange={(variant) => {
              setSelectedVariant(variant);
              if (activeSessionId && activeWorkspaceId) {
                if (variant) {
                  setSessionVariant(
                    activeSessionId,
                    activeWorkspaceId,
                    variant,
                  );
                }
              }
            }}
            isVariantSelectorOpen={isVariantSelectorOpen}
            onVariantSelectorOpenChange={setIsVariantSelectorOpen}
          />
        </div>
      </ChatDisplayContext.Provider>

      {isTaskPanelOpen && (
        <>
          <div
            className="hover:bg-accent/50 active:bg-accent hidden w-1.5 shrink-0 cursor-col-resize items-center justify-center transition-colors md:flex"
            onMouseDown={handleTaskPanelDragStart}
          >
            <GripVertical className="text-muted-foreground/30 size-3.5" />
          </div>
          <div
            ref={(el) => {
              taskPanelFocusRef.current = el;
            }}
            tabIndex={-1}
            className="relative hidden shrink-0 overflow-y-auto border-l md:block"
            style={{ width: taskPanelWidth }}
          >
            <div className="flex h-10 items-center justify-between border-b px-3">
              <span className="text-muted-foreground text-xs font-medium">
                Side Panel
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
            {activeWorkspaceId && activeWorkspace && (
              <WorkspaceContextPanel
                workspaceId={activeWorkspaceId}
                workspace={activeWorkspace}
              />
            )}
            {activeTodos.length > 0 && (
              <>
                <div className="border-t px-3 py-2">
                  <span className="text-muted-foreground text-xs font-medium">
                    Task Progress
                  </span>
                </div>
                <div className="px-3 pb-3">
                  <TaskProgressPanel todos={activeTodos} />
                </div>
              </>
            )}
            <div className="border-t px-3 py-2">
              <span className="text-muted-foreground text-xs font-medium">
                MCP Servers
              </span>
            </div>
            <div className="px-3 pb-3">
              <McpStatusPanel />
            </div>
            <div className="border-t px-3 py-2">
              <span className="text-muted-foreground text-xs font-medium">
                Session Files
              </span>
            </div>
            <div className="px-3 pb-3">
              <SessionFilesPanel
                messages={activeMessagesRaw}
                workspacePath={activeWorkspacePath}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

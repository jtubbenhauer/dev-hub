import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useSessionListActivity } from "@/components/chat/use-session-list-activity";
import { useSessionManagement } from "@/components/chat/use-session-management";
import { useAgentHealth, useGitStatus } from "@/hooks/use-git";
import type { ChatEngine } from "@/lib/engine/types";
import {
  countRootSessions,
  filterSessionsByAge,
  isSessionListLoading,
  parseSessionAgeFilter,
  type SessionAgeFilter,
} from "@/lib/session-filters";
import { getEffectiveChatSessionId } from "@/lib/workbench/effective-chat-session";
import { openNewChatInWorkbench } from "@/lib/workbench/open-in-workbench";
import { shouldSSEConnect } from "@/lib/workspaces/behaviour";
import { useChatStore } from "@/stores/chat-store";
import { useNewChatEngineStore } from "@/stores/new-chat-engine-store";
import {
  selectLastFocusedChatSessionId,
  useWorkbenchStore,
} from "@/stores/workbench-store";
import { useWorkspaceStore } from "@/stores/workspace-store";

const EMPTY_LAST_VIEWED: Record<string, number> = {};

// In grouped mode, we still cap per-workspace to avoid sorting thousands of
// sessions. WorkspaceGroup already collapses to ~3 visible per group.
const MAX_GROUPED_PER_WORKSPACE = 50;

interface UseWorkbenchSessionListOptions {
  // Fires on every pick or create click; the mobile sheet closes itself with it.
  readonly onPick?: () => void;
}

// Retargets (and activates) the workspace's last-focused chat tab; with no
// chat tab open, the consumer opens a new one.
function requestActivatedChatTarget(
  targetWorkspaceId: string,
  sessionId: string,
  layoutWorkspaceId: string,
): void {
  const workbench = useWorkbenchStore.getState();
  const panelId =
    targetWorkspaceId === layoutWorkspaceId
      ? (workbench.lastFocusedPanelByWorkspace[targetWorkspaceId]?.chat
          ?.panelId ?? null)
      : null;
  workbench.requestChatTarget({
    workspaceId: targetWorkspaceId,
    sessionId,
    panelId,
    shouldActivate: true,
  });
}

export function useWorkbenchSessionList(
  workspaceId: string,
  { onPick }: UseWorkbenchSessionListOptions = {},
) {
  const router = useRouter();
  const allWorkspaces = useWorkspaceStore((state) => state.workspaces);
  const activeWorkspace = useMemo(
    () => allWorkspaces.find((w) => w.id === workspaceId) ?? null,
    [allWorkspaces, workspaceId],
  );
  const isWorkspaceRemote = activeWorkspace?.backend === "remote";
  const { data: healthStatus } = useAgentHealth(workspaceId, isWorkspaceRemote);
  useGitStatus(workspaceId);

  // The highlighted session is the last-focused chat tab's effective session,
  // never the global activeSessionId.
  const lastFocusedSessionId = useWorkbenchStore((state) =>
    selectLastFocusedChatSessionId(state, workspaceId),
  );
  const activeSessionId = useChatStore((state) =>
    getEffectiveChatSessionId(
      state.workspaceStates[workspaceId],
      lastFocusedSessionId,
    ),
  );

  const handleSessionChosen = useCallback(
    (chosenWorkspaceId: string, sessionId: string) => {
      requestActivatedChatTarget(chosenWorkspaceId, sessionId, workspaceId);
    },
    [workspaceId],
  );

  const handleNewChatInWorkspace = useCallback(
    (targetWorkspaceId: string, engine?: ChatEngine) => {
      if (engine) {
        useNewChatEngineStore
          .getState()
          .setNewChatEngine(targetWorkspaceId, engine);
      }
      openNewChatInWorkbench({
        workspaceId: targetWorkspaceId,
        navigate: (href) => router.push(href),
      });
    },
    [router],
  );

  const {
    isUnifiedMode,
    groupByWorkspace,
    workspaceOrder,
    expandedWorkspaces,
    handleCreateSession,
    handleCreateSessionInWorkspace,
    handleDeleteSession,
    handleSelectSession,
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
    activeWorkspaceId: workspaceId,
    allWorkspaces,
    healthStatus,
    onSessionChosen: handleSessionChosen,
    onNewChatInWorkspace: handleNewChatInWorkspace,
  });

  const handleSelectSessionInWorkbench = useCallback(
    (sessionId: string) => {
      handleSelectSession(sessionId);
      requestActivatedChatTarget(workspaceId, sessionId, workspaceId);
      onPick?.();
    },
    [handleSelectSession, workspaceId, onPick],
  );

  const handleSelectUnifiedSessionInWorkbench = useCallback(
    (sessionId: string, sessionWorkspaceId: string) => {
      if (sessionWorkspaceId === workspaceId) {
        handleSelectSessionInWorkbench(sessionId);
        return;
      }
      handleSelectUnifiedSession(sessionId, sessionWorkspaceId);
      requestActivatedChatTarget(sessionWorkspaceId, sessionId, workspaceId);
      onPick?.();
    },
    [
      handleSelectSessionInWorkbench,
      handleSelectUnifiedSession,
      workspaceId,
      onPick,
    ],
  );

  const handleCreateSessionInWorkbench = useCallback(
    (engine?: ChatEngine) => {
      handleCreateSession(engine);
      onPick?.();
    },
    [handleCreateSession, onPick],
  );

  const handleCreateSessionInWorkspaceInWorkbench = useCallback(
    (targetWorkspaceId: string, engine?: ChatEngine) => {
      handleCreateSessionInWorkspace(targetWorkspaceId, engine);
      onPick?.();
    },
    [handleCreateSessionInWorkspace, onPick],
  );

  const workspaceColor = activeWorkspace?.color ?? undefined;

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

  const workspaceIds = useMemo(
    () => new Set(allWorkspaces.map((workspace) => workspace.id)),
    [allWorkspaces],
  );

  const sleepingWorkspaceIds = useMemo(() => {
    const ids = new Set<string>();
    for (const ws of allWorkspaces) {
      if (!shouldSSEConnect(ws, workspaceId)) {
        ids.add(ws.id);
      }
    }
    return ids;
  }, [allWorkspaces, workspaceId]);

  const [sessionAgeFilter, setSessionAgeFilterState] =
    useState<SessionAgeFilter>(() => {
      if (typeof window === "undefined") return "all";
      return parseSessionAgeFilter(
        localStorage.getItem("dev-hub:chat-session-age-filter"),
      );
    });
  const handleSetSessionAgeFilter = useCallback((filter: SessionAgeFilter) => {
    setSessionAgeFilterState(filter);
    if (typeof window !== "undefined") {
      localStorage.setItem("dev-hub:chat-session-age-filter", filter);
    }
  }, []);

  // combine's result is structurally shared, so the map keeps its identity
  // until a branch changes; the raw results array is new on every render.
  const workspaceBranches = useQueries({
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
    combine: (results) => {
      const branches: Record<string, string> = {};
      results.forEach((result, index) => {
        const workspace = allWorkspaces[index];
        if (workspace && result.data?.branch) {
          branches[workspace.id] = result.data.branch;
        }
      });
      return branches;
    },
  });

  const {
    getActiveWorkspaceSessions,
    getActiveSessionStatuses,
    getUnifiedSessionStatuses,
    getActiveQuestionSessionIds,
    getUnifiedQuestionSessionIds,
    getUnifiedLastViewedAt,
    getUnifiedPinnedSessionIds,
    getActivePinnedSessionIds,
    getActiveSessionNotes,
    getUnifiedSessionNotes,
  } = useChatStore.getState();

  const sessions = useChatStore(getActiveWorkspaceSessions);
  const [unifiedLimit, setUnifiedLimit] = useState(20);
  const effectiveUnifiedLimit = groupByWorkspace
    ? allWorkspaces.length * MAX_GROUPED_PER_WORKSPACE
    : unifiedLimit;
  const allUnifiedSessions = useChatStore((state) =>
    state.getRecentSessionsAcrossWorkspaces(effectiveUnifiedLimit),
  );
  const unifiedSessions = useMemo(
    () => allUnifiedSessions.filter((s) => workspaceIds.has(s.workspaceId)),
    [allUnifiedSessions, workspaceIds],
  );
  const totalUnifiedCount = useChatStore((state) =>
    countRootSessions(state.workspaceStates),
  );
  const hasMoreUnifiedSessions = totalUnifiedCount > unifiedLimit;
  const handleLoadMoreUnifiedSessions = useCallback(
    () => setUnifiedLimit((limit) => limit + 20),
    [],
  );

  const activeWsSessionStatuses = useChatStore(getActiveSessionStatuses);
  const activeWsLastViewedAt = useChatStore((s) => {
    return s.workspaceStates[workspaceId]?.lastViewedAt ?? EMPTY_LAST_VIEWED;
  });
  const unifiedStatuses = useChatStore(getUnifiedSessionStatuses);
  const unifiedLastViewed = useChatStore(getUnifiedLastViewedAt);
  const sessionStatuses = isUnifiedMode
    ? unifiedStatuses
    : activeWsSessionStatuses;
  const lastViewedAt = isUnifiedMode ? unifiedLastViewed : activeWsLastViewedAt;

  const fetchSessionTodos = useChatStore((state) => state.fetchSessionTodos);
  const {
    taskProgressBySessionId,
    taskActiveSessionIds,
    permissionBlockedSessionIds,
    subAgentCountBySessionId,
    subAgentTodoHydration,
  } = useSessionListActivity({ isUnifiedMode, activeWorkspaceId: workspaceId });
  // Hydrate once per session: a todo fetch that keeps failing would otherwise
  // be retried on every store change.
  const hydratedSubAgentTodosRef = useRef(new Set<string>());
  useEffect(() => {
    for (const hydration of subAgentTodoHydration) {
      const key = `${hydration.workspaceId}:${hydration.sessionId}`;
      if (hydratedSubAgentTodosRef.current.has(key)) continue;
      hydratedSubAgentTodosRef.current.add(key);
      void fetchSessionTodos(hydration.sessionId, hydration.workspaceId);
    }
  }, [fetchSessionTodos, subAgentTodoHydration]);

  const unifiedPinnedIds = useChatStore(getUnifiedPinnedSessionIds);
  const activePinnedIds = useChatStore(getActivePinnedSessionIds);
  const pinnedSessionIds = isUnifiedMode ? unifiedPinnedIds : activePinnedIds;
  const filteredUnifiedSessions = useMemo(
    () =>
      filterSessionsByAge(unifiedSessions, sessionAgeFilter, unifiedPinnedIds),
    [unifiedSessions, sessionAgeFilter, unifiedPinnedIds],
  );
  const unifiedSessionNotes = useChatStore(getUnifiedSessionNotes);
  const activeSessionNotes = useChatStore(getActiveSessionNotes);
  const sessionNotes = isUnifiedMode ? unifiedSessionNotes : activeSessionNotes;
  const activeQuestionSessionIds = useChatStore(getActiveQuestionSessionIds);
  const unifiedQuestionSessionIds = useChatStore(getUnifiedQuestionSessionIds);
  const questionSessionIds = isUnifiedMode
    ? unifiedQuestionSessionIds
    : activeQuestionSessionIds;

  const isSessionsLoading = useChatStore((s) => {
    return isSessionListLoading(s.workspaceStates, workspaceId);
  });

  const sharedProps = {
    activeSessionId,
    sessionStatuses,
    questionSessionIds,
    permissionBlockedSessionIds,
    lastViewedAt,
    isLoading: isSessionsLoading,
    pinnedSessionIds,
    taskProgressBySessionId,
    taskActiveSessionIds,
    subAgentCountBySessionId,
    sessionNotes,
    onCreateSession: handleCreateSessionInWorkbench,
    onDeleteSession: handleDeleteSession,
    onPinSession: handlePinSession,
    onUnpinSession: handleUnpinSession,
    onSetSessionNote: handleSetSessionNote,
    onClearSessionNote: handleClearSessionNote,
    isUnifiedMode,
    onToggleMode: handleToggleUnifiedMode,
  };

  const unifiedProps = {
    ...sharedProps,
    mode: "unified" as const,
    sessions: filteredUnifiedSessions,
    sessionAgeFilter,
    onSetSessionAgeFilter: handleSetSessionAgeFilter,
    workspaceNames,
    workspaceBranches,
    workspaceColors,
    hasMore: hasMoreUnifiedSessions,
    onLoadMore: handleLoadMoreUnifiedSessions,
    workspaces: workspaceOptions,
    activeWorkspaceId: workspaceId,
    onCreateSessionInWorkspace: handleCreateSessionInWorkspaceInWorkbench,
    onSelectSession: handleSelectUnifiedSessionInWorkbench,
    groupByWorkspace,
    onToggleGroupByWorkspace: handleToggleGroupByWorkspace,
    workspaceOrder,
    onWorkspaceOrderChange: handleWorkspaceOrderChange,
    expandedWorkspaces,
    onToggleWorkspaceExpanded: handleToggleWorkspaceExpanded,
    onWakeWorkspace: handleWakeWorkspace,
    sleepingWorkspaceIds,
  };

  const workspaceProps = {
    ...sharedProps,
    mode: "workspace" as const,
    sessions,
    workspaceColor,
    onSelectSession: handleSelectSessionInWorkbench,
  };

  return { isUnifiedMode, unifiedProps, workspaceProps };
}

import {
  useSessionCreate,
  type UseSessionCreateArgs,
} from "@/components/chat/use-session-create";
import { shouldSSEConnect } from "@/lib/workspaces/behaviour";
import { useChatStore } from "@/stores/chat-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

type UseSessionManagementArgs = UseSessionCreateArgs;

export function useSessionManagement({
  activeWorkspaceId,
  allWorkspaces,
  healthStatus,
  onSessionChosen,
  onNewChatInWorkspace,
}: UseSessionManagementArgs) {
  const {
    setActiveSession,
    setActiveWorkspaceId,
    setActiveWorkspaceSession,
    fetchSessions,
    deleteSession,
    removeSessionLocal,
    restoreSessionLocal,
    fetchPinnedSessions,
    fetchCachedSessions,
    pinSession,
    unpinSession,
    fetchSessionNotes,
    setSessionNote,
    clearSessionNote,
  } = useChatStore.getState();

  const {
    pendingSessionCreationWorkspaceId,
    resumeWorkspace,
    handleCreateSession,
    handleCreateSessionInWorkspace,
  } = useSessionCreate({
    activeWorkspaceId,
    allWorkspaces,
    healthStatus,
    onSessionChosen,
    onNewChatInWorkspace,
  });

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
      return JSON.parse(
        localStorage.getItem("dev-hub:chat-workspace-order") ?? "[]",
      );
    } catch {
      return [];
    }
  });
  const [expandedWorkspaces, setExpandedWorkspaces] = useState<
    Record<string, boolean>
  >(() => {
    if (typeof window === "undefined") return {};
    try {
      return JSON.parse(
        localStorage.getItem("dev-hub:chat-expanded-workspaces") ?? "{}",
      );
    } catch {
      return {};
    }
  });

  const pendingDeletions = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );

  const handleDeleteSession = useCallback(
    (sessionId: string, sessionWorkspaceId?: string) => {
      const workspaceId = sessionWorkspaceId ?? activeWorkspaceId;
      if (!workspaceId) return;
      const deletionKey = `${workspaceId}:${sessionId}`;

      const existing = pendingDeletions.current.get(deletionKey);
      if (existing) clearTimeout(existing);

      const snapshot = removeSessionLocal(sessionId, workspaceId);
      if (!snapshot) return;

      const timer = setTimeout(async () => {
        pendingDeletions.current.delete(deletionKey);
        const deletion = await deleteSession(sessionId, workspaceId);
        if (!deletion.isDeleted) {
          restoreSessionLocal(snapshot);
          toast.error(deletion.failureMessage);
        }
      }, 5000);

      pendingDeletions.current.set(deletionKey, timer);

      toast.success("Chat deleted", {
        duration: 5000,
        action: {
          label: "Undo",
          onClick: () => {
            const pending = pendingDeletions.current.get(deletionKey);
            if (pending) {
              clearTimeout(pending);
              pendingDeletions.current.delete(deletionKey);
            }
            restoreSessionLocal(snapshot);
          },
        },
      });
    },
    [activeWorkspaceId, deleteSession, removeSessionLocal, restoreSessionLocal],
  );

  // A pick never focuses a chat prompt: the chosen session may open in
  // another tab, and focusing here would steal the cursor from it.
  const handleSelectSession = useCallback(
    (sessionId: string) => setActiveSession(sessionId),
    [setActiveSession],
  );

  const handleSelectUnifiedSession = useCallback(
    (sessionId: string, workspaceId: string) => {
      const ws = allWorkspaces.find((w) => w.id === workspaceId);
      const isSleeping = ws && !shouldSSEConnect(ws, activeWorkspaceId);

      useWorkspaceStore.getState().setActiveWorkspaceId(workspaceId);
      setActiveWorkspaceSession(workspaceId, sessionId);

      if (isSleeping) {
        toast("Waking workspace…", {
          description: "This may take a few seconds",
        });
        fetchSessions(workspaceId);
      }
    },
    [
      allWorkspaces,
      activeWorkspaceId,
      setActiveWorkspaceSession,
      fetchSessions,
    ],
  );

  const handleToggleUnifiedMode = useCallback(() => {
    setIsUnifiedMode((prev) => {
      const next = !prev;
      localStorage.setItem("dev-hub:chat-unified-mode", String(next));
      if (next) {
        let delayIndex = 0;
        for (const ws of allWorkspaces) {
          const isActive = ws.id === activeWorkspaceId;
          if (isActive) {
            if (shouldSSEConnect(ws, activeWorkspaceId)) {
              fetchSessions(ws.id);
            } else {
              fetchCachedSessions(ws.id);
            }
          } else {
            const delay = ++delayIndex * 150;
            setTimeout(() => {
              fetchCachedSessions(ws.id);
            }, delay);
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
      localStorage.setItem(
        "dev-hub:chat-expanded-workspaces",
        JSON.stringify(next),
      );
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

  const handleSetSessionNote = useCallback(
    (sessionId: string, note: string, workspaceId?: string) => {
      const wsId = workspaceId ?? activeWorkspaceId;
      if (!wsId) return;
      setSessionNote(sessionId, wsId, note);
    },
    [activeWorkspaceId, setSessionNote],
  );

  const handleClearSessionNote = useCallback(
    (sessionId: string, workspaceId?: string) => {
      const wsId = workspaceId ?? activeWorkspaceId;
      if (!wsId) return;
      clearSessionNote(sessionId, wsId);
    },
    [activeWorkspaceId, clearSessionNote],
  );

  useEffect(() => {
    if (!isUnifiedMode) return;

    // Stagger non-active workspace fetches to avoid N parallel API calls on mount
    let cancelled = false;
    const timeouts: ReturnType<typeof setTimeout>[] = [];

    let delayIndex = 0;
    for (const ws of allWorkspaces) {
      const isSSE = shouldSSEConnect(ws, activeWorkspaceId);
      const isActive = ws.id === activeWorkspaceId;

      if (isActive) {
        // Fetch active workspace immediately — live fetch
        if (isSSE) {
          fetchSessions(ws.id);
          fetchPinnedSessions(ws.id);
        } else {
          fetchCachedSessions(ws.id);
        }
        fetchSessionNotes(ws.id);
      } else {
        // Non-active workspaces use cached sessions to avoid a proxy storm.
        // Pins and notes are still fetched: both are local dev-hub DB reads
        // (no remote proxy), so age-filtered unified views don't drop pinned
        // sessions until the workspace is opened. Live sessions load on switch.
        const delay = ++delayIndex * 150;
        const timer = setTimeout(() => {
          if (cancelled) return;
          fetchCachedSessions(ws.id);
          fetchPinnedSessions(ws.id);
          fetchSessionNotes(ws.id);
        }, delay);
        timeouts.push(timer);
      }
    }

    return () => {
      cancelled = true;
      for (const t of timeouts) clearTimeout(t);
    };
  }, [
    isUnifiedMode,
    allWorkspaces,
    activeWorkspaceId,
    fetchSessions,
    fetchPinnedSessions,
    fetchSessionNotes,
    fetchCachedSessions,
  ]);

  return {
    isUnifiedMode,
    groupByWorkspace,
    workspaceOrder,
    expandedWorkspaces,
    pendingSessionCreationWorkspaceId,

    resumeWorkspace,
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
  };
}

import { shouldSSEConnect } from "@/lib/workspaces/behaviour";
import { useChatStore } from "@/stores/chat-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { Workspace } from "@/types";
import type { RefObject } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { PromptInputHandle } from "@/components/chat/prompt-input";

interface UseSessionManagementArgs {
  activeWorkspaceId: string | null;
  allWorkspaces: Workspace[];
  healthStatus: string | undefined;
  promptInputRef: RefObject<PromptInputHandle | null>;
}

export function useSessionManagement({
  activeWorkspaceId,
  allWorkspaces,
  healthStatus,
  promptInputRef,
}: UseSessionManagementArgs) {
  const {
    setActiveSession,
    setActiveWorkspaceId,
    fetchSessions,
    createSession,
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

  const [
    pendingSessionCreationWorkspaceId,
    setPendingSessionCreationWorkspaceId,
  ] = useState<string | null>(null);
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
  const [isMobileSessionsOpen, setIsMobileSessionsOpen] = useState(false);

  const resumeWorkspace = useCallback(async (workspaceId: string) => {
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/start`, {
        method: "POST",
      });
      if (!res.ok && res.status !== 409) {
        const err = await res
          .json()
          .catch(() => ({ error: "Failed to resume workspace" }));
        throw new Error(err.error || "Failed to resume workspace");
      }
      toast.success("Starting workspace...");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to resume workspace",
      );
    }
  }, []);

  // Create session once workspace becomes healthy after resume
  useEffect(() => {
    if (!pendingSessionCreationWorkspaceId) return;
    if (healthStatus !== "healthy") return;

    const ws = allWorkspaces.find(
      (w) => w.id === pendingSessionCreationWorkspaceId,
    );
    if (!ws || ws.backend !== "remote") {
      setPendingSessionCreationWorkspaceId(null);
      return;
    }

    (async () => {
      await createSession(pendingSessionCreationWorkspaceId);
      setPendingSessionCreationWorkspaceId(null);
    })();
  }, [
    pendingSessionCreationWorkspaceId,
    healthStatus,
    allWorkspaces,
    createSession,
  ]);

  const handleCreateSession = useCallback(() => {
    if (!activeWorkspaceId) return;

    const ws = allWorkspaces.find((w) => w.id === activeWorkspaceId);
    if (ws?.backend === "remote" && healthStatus !== "healthy") {
      setPendingSessionCreationWorkspaceId(activeWorkspaceId);
      resumeWorkspace(activeWorkspaceId);
      return;
    }

    createSession(activeWorkspaceId);
  }, [
    activeWorkspaceId,
    allWorkspaces,
    healthStatus,
    createSession,
    resumeWorkspace,
  ]);

  const handleCreateSessionInWorkspace = useCallback(
    (workspaceId: string) => {
      useWorkspaceStore.getState().setActiveWorkspaceId(workspaceId);
      setActiveWorkspaceId(workspaceId);

      const ws = allWorkspaces.find((w) => w.id === workspaceId);
      if (ws?.backend === "remote" && healthStatus !== "healthy") {
        setPendingSessionCreationWorkspaceId(workspaceId);
        resumeWorkspace(workspaceId);
        return;
      }

      createSession(workspaceId);
    },
    [
      setActiveWorkspaceId,
      allWorkspaces,
      healthStatus,
      createSession,
      resumeWorkspace,
    ],
  );

  const pendingDeletions = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );

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
    [setActiveSession, promptInputRef],
  );

  const handleMobileSelectSession = useCallback(
    (sessionId: string) => {
      setActiveSession(sessionId);
      setIsMobileSessionsOpen(false);
      requestAnimationFrame(() => promptInputRef.current?.focus());
    },
    [setActiveSession, promptInputRef],
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
    [
      allWorkspaces,
      activeWorkspaceId,
      setActiveWorkspaceId,
      setActiveSession,
      fetchSessions,
      promptInputRef,
    ],
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
    for (const ws of allWorkspaces) {
      if (shouldSSEConnect(ws, activeWorkspaceId)) {
        fetchSessions(ws.id);
        fetchPinnedSessions(ws.id);
        fetchSessionNotes(ws.id);
      } else {
        fetchCachedSessions(ws.id);
        fetchSessionNotes(ws.id);
      }
    }
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
    isMobileSessionsOpen,
    setIsMobileSessionsOpen,
    pendingSessionCreationWorkspaceId,

    resumeWorkspace,
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
  };
}

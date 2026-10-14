import type { ChatEngine } from "@/lib/engine/types";
import { shouldSSEConnect } from "@/lib/workspaces/behaviour";
import { useChatStore } from "@/stores/chat-store";
import { getNewChatEngineChoice } from "@/stores/new-chat-engine-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useIsMobile, useHasCoarsePointer } from "@/hooks/use-mobile";
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

interface PendingSessionCreation {
  workspaceId: string;
  engine: ChatEngine | undefined;
}

export function useSessionManagement({
  activeWorkspaceId,
  allWorkspaces,
  healthStatus,
  promptInputRef,
}: UseSessionManagementArgs) {
  const isMobile = useIsMobile();
  const hasCoarsePointer = useHasCoarsePointer();
  const shouldSuppressAutoFocus = isMobile || hasCoarsePointer;
  const {
    setActiveSession,
    setActiveWorkspaceId,
    setActiveWorkspaceSession,
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

  const [pendingSessionCreation, setPendingSessionCreation] =
    useState<PendingSessionCreation | null>(null);
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

  const createChat = useCallback(
    async (workspaceId: string, engine: ChatEngine | undefined) => {
      const session = await createSession(
        workspaceId,
        engine ?? getNewChatEngineChoice(workspaceId),
      );
      if (!session) toast.error("Couldn't create a new chat");
    },
    [createSession],
  );

  // Create session once workspace becomes healthy after resume
  useEffect(() => {
    if (!pendingSessionCreation) return;
    if (healthStatus !== "healthy") return;

    const ws = allWorkspaces.find(
      (w) => w.id === pendingSessionCreation.workspaceId,
    );
    if (!ws || ws.backend !== "remote") {
      setPendingSessionCreation(null);
      return;
    }

    (async () => {
      await createChat(
        pendingSessionCreation.workspaceId,
        pendingSessionCreation.engine,
      );
      setPendingSessionCreation(null);
    })();
  }, [pendingSessionCreation, healthStatus, allWorkspaces, createChat]);

  const handleCreateSession = useCallback(
    (engine?: ChatEngine) => {
      if (!activeWorkspaceId) return;

      const ws = allWorkspaces.find((w) => w.id === activeWorkspaceId);
      if (ws?.backend === "remote" && healthStatus !== "healthy") {
        setPendingSessionCreation({ workspaceId: activeWorkspaceId, engine });
        resumeWorkspace(activeWorkspaceId);
        return;
      }

      void createChat(activeWorkspaceId, engine);
    },
    [
      activeWorkspaceId,
      allWorkspaces,
      healthStatus,
      createChat,
      resumeWorkspace,
    ],
  );

  const handleCreateSessionInWorkspace = useCallback(
    (workspaceId: string, engine?: ChatEngine) => {
      useWorkspaceStore.getState().setActiveWorkspaceId(workspaceId);
      setActiveWorkspaceId(workspaceId);

      const ws = allWorkspaces.find((w) => w.id === workspaceId);
      if (ws?.backend === "remote" && healthStatus !== "healthy") {
        setPendingSessionCreation({ workspaceId, engine });
        resumeWorkspace(workspaceId);
        return;
      }

      void createChat(workspaceId, engine);
    },
    [
      setActiveWorkspaceId,
      allWorkspaces,
      healthStatus,
      createChat,
      resumeWorkspace,
    ],
  );

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

  const handleSelectSession = useCallback(
    (sessionId: string) => {
      setActiveSession(sessionId);
      if (!shouldSuppressAutoFocus) {
        requestAnimationFrame(() => promptInputRef.current?.focus());
      }
    },
    [setActiveSession, promptInputRef, shouldSuppressAutoFocus],
  );

  const handleMobileSelectSession = useCallback(
    (sessionId: string) => {
      setActiveSession(sessionId);
      setIsMobileSessionsOpen(false);
      if (!shouldSuppressAutoFocus) {
        requestAnimationFrame(() => promptInputRef.current?.focus());
      }
    },
    [setActiveSession, promptInputRef, shouldSuppressAutoFocus],
  );

  const handleMobileCreateSession = useCallback(
    (engine?: ChatEngine) => {
      if (!activeWorkspaceId) return;
      void createChat(activeWorkspaceId, engine);
      setIsMobileSessionsOpen(false);
    },
    [activeWorkspaceId, createChat],
  );

  const handleSelectUnifiedSession = useCallback(
    (sessionId: string, workspaceId: string) => {
      const ws = allWorkspaces.find((w) => w.id === workspaceId);
      const isSleeping = ws && !shouldSSEConnect(ws, activeWorkspaceId);

      useWorkspaceStore.getState().setActiveWorkspaceId(workspaceId);
      setActiveWorkspaceSession(workspaceId, sessionId);
      setIsMobileSessionsOpen(false);
      if (!shouldSuppressAutoFocus) {
        requestAnimationFrame(() => promptInputRef.current?.focus());
      }

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
      promptInputRef,
      shouldSuppressAutoFocus,
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
    isMobileSessionsOpen,
    setIsMobileSessionsOpen,
    pendingSessionCreationWorkspaceId:
      pendingSessionCreation?.workspaceId ?? null,

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

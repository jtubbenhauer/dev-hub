import type { ChatEngine } from "@/lib/engine/types";
import { useChatStore } from "@/stores/chat-store";
import { getNewChatEngineChoice } from "@/stores/new-chat-engine-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { Workspace } from "@/types";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

export interface UseSessionCreateArgs {
  activeWorkspaceId: string | null;
  allWorkspaces: Workspace[];
  healthStatus: string | undefined;
  // Tells the caller which session a create produced (after remote resume too).
  onSessionChosen?: (workspaceId: string, sessionId: string) => void;
  // Opens a new chat in another workspace's layout instead of creating here.
  onNewChatInWorkspace?: (workspaceId: string, engine?: ChatEngine) => void;
}

interface PendingSessionCreation {
  workspaceId: string;
  engine: ChatEngine | undefined;
}

export function useSessionCreate({
  activeWorkspaceId,
  allWorkspaces,
  healthStatus,
  onSessionChosen,
  onNewChatInWorkspace,
}: UseSessionCreateArgs) {
  const { setActiveWorkspaceId, createSession } = useChatStore.getState();

  const [pendingSessionCreation, setPendingSessionCreation] =
    useState<PendingSessionCreation | null>(null);
  // A ref keeps createChat stable, so the pending-creation effect below never
  // re-runs (and creates a second chat) because the caller's callback changed.
  const onSessionChosenRef = useRef(onSessionChosen);
  useEffect(() => {
    onSessionChosenRef.current = onSessionChosen;
  }, [onSessionChosen]);

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
      if (!session) {
        toast.error("Couldn't create a new chat");
        return null;
      }
      onSessionChosenRef.current?.(workspaceId, session.id);
      return session;
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
      const ws = allWorkspaces.find((w) => w.id === workspaceId);
      const isResumeNeeded =
        ws?.backend === "remote" && healthStatus !== "healthy";

      // Switching workspaces remounts the workbench layout and unmounts the
      // caller, so a pending creation here would never run.
      if (onNewChatInWorkspace && workspaceId !== activeWorkspaceId) {
        if (isResumeNeeded) void resumeWorkspace(workspaceId);
        onNewChatInWorkspace(workspaceId, engine);
        return;
      }

      useWorkspaceStore.getState().setActiveWorkspaceId(workspaceId);
      setActiveWorkspaceId(workspaceId);

      if (isResumeNeeded) {
        setPendingSessionCreation({ workspaceId, engine });
        resumeWorkspace(workspaceId);
        return;
      }

      void createChat(workspaceId, engine);
    },
    [
      activeWorkspaceId,
      setActiveWorkspaceId,
      allWorkspaces,
      healthStatus,
      createChat,
      onNewChatInWorkspace,
      resumeWorkspace,
    ],
  );

  return {
    pendingSessionCreationWorkspaceId:
      pendingSessionCreation?.workspaceId ?? null,
    resumeWorkspace,
    handleCreateSession,
    handleCreateSessionInWorkspace,
  };
}

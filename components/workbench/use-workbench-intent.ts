import { useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  applyWorkbenchIntent,
  type ApplyWorkbenchIntentDeps,
} from "@/components/workbench/apply-workbench-intent";
import { useFileTabsSetting } from "@/hooks/use-settings";
import { getEffectiveChatSessionId } from "@/lib/workbench/effective-chat-session";
import {
  openFileInWorkbench,
  type WorkbenchNavigate,
} from "@/lib/workbench/open-in-workbench";
import {
  getWorkbenchController,
  type WorkbenchController,
} from "@/lib/workbench/workbench-controller-registry";
import {
  createWorkbenchHref,
  parseWorkbenchIntent,
  WORKBENCH_PATH,
} from "@/lib/workbench/workbench-href";
import { useChatStore } from "@/stores/chat-store";
import { useContentSearchStore } from "@/stores/content-search-store";
import { useContextSidebarStore } from "@/stores/context-sidebar-store";
import { useEditorStore } from "@/stores/editor-store";
import { useWorkbenchStore } from "@/stores/workbench-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { Workspace } from "@/types";

export interface UseWorkbenchIntentInput {
  readonly activeWorkspaceId: string | null;
  readonly workspaces: readonly Workspace[];
}

interface IntentDepsInput {
  readonly workspaceId: string;
  readonly controller: WorkbenchController;
  readonly isFileTabsDisabled: boolean;
  readonly navigate: WorkbenchNavigate;
}

function createIntentDeps(input: IntentDepsInput): ApplyWorkbenchIntentDeps {
  const { workspaceId, controller, isFileTabsDisabled, navigate } = input;
  return {
    workspaceId,
    controller,
    requestChatTarget: useWorkbenchStore.getState().requestChatTarget,
    setActiveWorkspaceSession:
      useChatStore.getState().setActiveWorkspaceSession,
    setContextSidebarView: useContextSidebarStore.getState().openView,
    expandFolder: useEditorStore.getState().expandFolder,
    setContentSearchView: useContentSearchStore.getState().setSidebarView,
    openFile: (path) => {
      void openFileInWorkbench({
        workspaceId,
        path,
        isFileTabsDisabled,
        navigate,
      });
    },
    isKnownMissingSession: (sessionWorkspaceId, sessionId) =>
      getEffectiveChatSessionId(
        useChatStore.getState().workspaceStates[sessionWorkspaceId],
        sessionId,
      ) === null,
  };
}

// Applies a `?open=` workbench intent from the URL once the target workspace's
// layout is ready. Each query string is processed once. A live chat link stays
// in the URL; the focused chat tab's session is then mirrored back into it, so
// switching chats adds history entries and a reload reopens the same chat.
export function useWorkbenchIntent({
  activeWorkspaceId,
  workspaces,
}: UseWorkbenchIntentInput): void {
  const router = useRouter();
  const queryString = useSearchParams().toString();
  const layoutReadyWorkspaceId = useWorkbenchStore(
    (state) => state.layoutReadyWorkspaceId,
  );
  const { isFileTabsDisabled } = useFileTabsSetting();
  // Every applied intent targets the active workspace (a linked one is
  // switched to first), so its session list is the one a chat link needs.
  const isActiveSessionListLoaded = useChatStore(
    (state) =>
      activeWorkspaceId !== null &&
      state.workspaceStates[activeWorkspaceId]?.sessionsLoaded === true,
  );
  const lastProcessedQueryRef = useRef("");
  const lastSyncedFocusRef = useRef("");
  const focusedChatWorkspaceId = useWorkbenchStore((state) =>
    state.focusedPanel?.params.kind === "chat"
      ? state.focusedPanel.params.workspaceId
      : null,
  );
  const focusedChatSessionId = useWorkbenchStore((state) =>
    state.focusedPanel?.params.kind === "chat"
      ? state.focusedPanel.params.sessionId
      : null,
  );

  useEffect(() => {
    // An empty query re-arms the ref, so following the same link again acts again.
    if (queryString === "") {
      lastProcessedQueryRef.current = "";
      return;
    }
    if (lastProcessedQueryRef.current === queryString) return;
    const finishIntent = (shouldKeepQuery = false) => {
      lastProcessedQueryRef.current = queryString;
      if (!shouldKeepQuery) router.replace(WORKBENCH_PATH);
    };

    const intent = parseWorkbenchIntent(new URLSearchParams(queryString));
    if (intent === null) {
      finishIntent();
      return;
    }
    if (intent.workspaceId !== null) {
      if (workspaces.length === 0) return;
      // A stale link to a deleted workspace must not keep switching to it.
      if (
        !workspaces.some((workspace) => workspace.id === intent.workspaceId)
      ) {
        finishIntent();
        return;
      }
      // The ref stays unset, so the intent applies once that layout is ready.
      if (intent.workspaceId !== activeWorkspaceId) {
        useWorkspaceStore.getState().setActiveWorkspaceId(intent.workspaceId);
        return;
      }
    }

    const workspaceId = intent.workspaceId ?? activeWorkspaceId;
    if (workspaceId === null || layoutReadyWorkspaceId !== workspaceId) return;
    // Only a loaded session list can tell a dead session id from a live one.
    if (
      intent.open === "chat" &&
      intent.sessionId !== null &&
      !isActiveSessionListLoaded
    ) {
      return;
    }
    const controller = getWorkbenchController();
    if (controller?.workspaceId !== workspaceId) return;
    const deps = createIntentDeps({
      workspaceId,
      controller,
      isFileTabsDisabled,
      navigate: (href) => router.push(href),
    });
    applyWorkbenchIntent(intent, deps);
    finishIntent(
      intent.open === "chat" &&
        intent.sessionId !== null &&
        !deps.isKnownMissingSession(workspaceId, intent.sessionId),
    );
  }, [
    activeWorkspaceId,
    isActiveSessionListLoaded,
    isFileTabsDisabled,
    layoutReadyWorkspaceId,
    queryString,
    router,
    workspaces,
  ]);

  // Declared after the intent effect so a just-applied link counts as processed.
  useEffect(() => {
    if (focusedChatWorkspaceId === null || focusedChatSessionId === null) {
      return;
    }
    // A link still waiting to apply owns the URL until it lands.
    if (queryString !== "" && lastProcessedQueryRef.current !== queryString) {
      return;
    }
    // Only a focus change writes the URL; a URL change alone (back/forward)
    // is applied by the intent effect and its focus change lands later.
    const focusKey = `${focusedChatWorkspaceId}\u0000${focusedChatSessionId}`;
    if (lastSyncedFocusRef.current === focusKey) return;
    lastSyncedFocusRef.current = focusKey;
    const currentIntent = parseWorkbenchIntent(
      new URLSearchParams(queryString),
    );
    const currentSessionId =
      currentIntent?.open === "chat" ? currentIntent.sessionId : null;
    if (
      currentSessionId === focusedChatSessionId &&
      currentIntent?.workspaceId === focusedChatWorkspaceId
    ) {
      return;
    }
    const href = createWorkbenchHref({
      open: "chat",
      workspaceId: focusedChatWorkspaceId,
      sessionId: focusedChatSessionId,
    });
    // Our own write must not be re-applied as an incoming link.
    lastProcessedQueryRef.current = href.slice(href.indexOf("?") + 1);
    // Switching chats is a history step; a new chat getting its id, or a
    // link being canonicalised, is not.
    if (currentSessionId === null || currentSessionId === focusedChatSessionId)
      router.replace(href);
    else router.push(href);
  }, [focusedChatSessionId, focusedChatWorkspaceId, queryString, router]);
}

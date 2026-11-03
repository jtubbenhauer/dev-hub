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
// layout is ready, then clears the query. Each query string is processed once.
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

  useEffect(() => {
    // An empty query re-arms the ref, so following the same link again acts again.
    if (queryString === "") {
      lastProcessedQueryRef.current = "";
      return;
    }
    if (lastProcessedQueryRef.current === queryString) return;
    const finishIntent = () => {
      lastProcessedQueryRef.current = queryString;
      router.replace(WORKBENCH_PATH);
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
    applyWorkbenchIntent(
      intent,
      createIntentDeps({
        workspaceId,
        controller,
        isFileTabsDisabled,
        navigate: (href) => router.push(href),
      }),
    );
    finishIntent();
  }, [
    activeWorkspaceId,
    isActiveSessionListLoaded,
    isFileTabsDisabled,
    layoutReadyWorkspaceId,
    queryString,
    router,
    workspaces,
  ]);
}

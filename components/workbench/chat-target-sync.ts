import {
  consumeChatTarget,
  resyncGlobalChatSession,
} from "@/components/workbench/consume-chat-target";
import {
  createChatSessionTitleLookups,
  workbenchTabTitle,
} from "@/components/workbench/workbench-tab-title";
import { getEffectiveChatSessionId } from "@/lib/workbench/effective-chat-session";
import type { WorkbenchLayoutApi } from "@/lib/workbench/workbench-layout-api";
import { useChatStore } from "@/stores/chat-store";
import {
  useWorkbenchStore,
  type PendingChatTarget,
} from "@/stores/workbench-store";
import { useWorkspaceStore } from "@/stores/workspace-store";

export interface ChatTargetSyncInput {
  readonly layoutApi: WorkbenchLayoutApi;
  readonly workspaceId: string;
}

function chatTargetTitle(target: PendingChatTarget): string {
  return workbenchTabTitle(
    {
      kind: "chat",
      workspaceId: target.workspaceId,
      sessionId: target.sessionId,
    },
    createChatSessionTitleLookups(useChatStore.getState().workspaceStates),
  );
}

// Moves chat tabs only for `pendingChatTarget`; a changed global
// `activeSessionId` never moves a tab. Returns the dispose function.
export function startChatTargetSync({
  layoutApi,
  workspaceId,
}: ChatTargetSyncInput): () => void {
  const consumePendingChatTarget = () => {
    const { layoutReadyWorkspaceId, pendingChatTarget } =
      useWorkbenchStore.getState();
    if (layoutReadyWorkspaceId !== workspaceId) return;
    if (pendingChatTarget?.workspaceId !== workspaceId) return;
    consumeChatTarget(
      layoutApi,
      useWorkbenchStore.getState(),
      workspaceId,
      chatTargetTitle,
    );
    resyncGlobalChatSession(layoutApi, workspaceId, useChatStore.getState());
  };
  const unsubscribe = useWorkbenchStore.subscribe((state, previousState) => {
    if (
      state.pendingChatTarget === previousState.pendingChatTarget &&
      state.layoutReadyWorkspaceId === previousState.layoutReadyWorkspaceId
    ) {
      return;
    }
    consumePendingChatTarget();
  });
  // A target may have been queued before this layout mounted.
  consumePendingChatTarget();
  return unsubscribe;
}

// Tab → global: a focused chat tab makes its session the global one.
export function syncGlobalChatSessionToTab(
  workspaceId: string,
  tabSessionId: string | null,
): void {
  // A layout that is being replaced must not write its stale focus.
  if (useWorkspaceStore.getState().activeWorkspaceId !== workspaceId) return;
  const chatStore = useChatStore.getState();
  const sessionId = getEffectiveChatSessionId(
    chatStore.workspaceStates[workspaceId],
    tabSessionId,
  );
  if (sessionId !== null) {
    chatStore.setActiveWorkspaceSession(workspaceId, sessionId);
    return;
  }
  chatStore.setActiveSession(null);
  // setActiveSession keeps the error, which belongs to the previous chat.
  useChatStore.setState({ streamingError: null });
}

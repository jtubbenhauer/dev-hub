import {
  getEffectiveChatSessionId,
  type ChatSessionListSource,
} from "@/lib/workbench/effective-chat-session";
import type { WorkbenchTabParams } from "@/lib/workbench/tab-descriptors";
import {
  applyChatTarget,
  getActivePanel,
  resolveChatTarget,
} from "@/lib/workbench/workbench-commands";
import type { WorkbenchLayoutApi } from "@/lib/workbench/workbench-layout-api";
import type { PendingChatTarget } from "@/stores/workbench-store";
import { useWorkspaceStore } from "@/stores/workspace-store";

// The workbench-store slice the consumer needs (`useWorkbenchStore.getState()`).
export interface ChatTargetQueue {
  readonly takePendingChatTarget: (
    workspaceId: string,
  ) => PendingChatTarget | null;
  readonly updateLastFocusedParams: (
    workspaceId: string,
    panelId: string,
    params: WorkbenchTabParams,
  ) => void;
}

// The chat-store slice behind the global session (`useChatStore.getState()`).
export interface GlobalChatSessionStore {
  readonly activeWorkspaceId: string | null;
  readonly activeSessionId: string | null;
  readonly workspaceStates: Readonly<
    Record<string, ChatSessionListSource | undefined>
  >;
  readonly setActiveSession: (sessionId: string | null) => void;
  readonly setActiveWorkspaceSession: (
    workspaceId: string,
    sessionId: string,
  ) => void;
}

export type ChatTargetTitle = (target: PendingChatTarget) => string;

// Applies this workspace's pending chat target; returns the affected panel id.
export function consumeChatTarget(
  layoutApi: WorkbenchLayoutApi,
  store: ChatTargetQueue,
  workspaceId: string,
  titleFor: ChatTargetTitle,
): string | null {
  const target = store.takePendingChatTarget(workspaceId);
  if (target === null) return null;
  const { action } = resolveChatTarget(layoutApi.getPanels(), target);
  const panelId = applyChatTarget(layoutApi, target, titleFor(target));
  // A retarget fires no focus event, so the recorded params must follow it.
  if (action === "retarget") {
    store.updateLastFocusedParams(workspaceId, panelId, {
      kind: "chat",
      workspaceId,
      sessionId: target.sessionId,
    });
  }
  return panelId;
}

// createSession makes its new session global even in a background tab, so
// the focused chat tab takes the global session back. setActiveSession keeps
// the focused chat's streamingError, setActiveWorkspaceSession clears it.
export function resyncGlobalChatSession(
  layoutApi: WorkbenchLayoutApi,
  workspaceId: string,
  chatStore: GlobalChatSessionStore,
): void {
  if (useWorkspaceStore.getState().activeWorkspaceId !== workspaceId) return;
  const activeParams = getActivePanel(layoutApi)?.params;
  if (activeParams?.kind !== "chat") return;
  const sessionId = getEffectiveChatSessionId(
    chatStore.workspaceStates[workspaceId],
    activeParams.sessionId,
  );
  const isGlobalWorkspace = chatStore.activeWorkspaceId === workspaceId;
  if (isGlobalWorkspace && chatStore.activeSessionId === sessionId) return;
  if (sessionId === null) {
    chatStore.setActiveSession(null);
  } else if (isGlobalWorkspace) {
    chatStore.setActiveSession(sessionId);
  } else {
    chatStore.setActiveWorkspaceSession(workspaceId, sessionId);
  }
}

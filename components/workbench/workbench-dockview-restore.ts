import type { DockviewApi, SerializedDockview } from "dockview-react";
import {
  createDockviewLayoutApi,
  createDockviewRestoredPanelSource,
} from "@/components/workbench/dockview-layout-api";
import {
  collapseToSingleGroup,
  ensureDefaultPanel,
  sanitizeRestoredPanels,
} from "@/components/workbench/workbench-layout-restore";
import {
  createChatSessionTitleLookups,
  workbenchTabTitle,
} from "@/components/workbench/workbench-tab-title";
import type { WorkbenchTabParams } from "@/lib/workbench/tab-descriptors";
import { useChatStore } from "@/stores/chat-store";
import { layoutStorageKey, useWorkbenchStore } from "@/stores/workbench-store";

export interface RestoreWorkbenchDockviewInput {
  readonly api: DockviewApi;
  readonly workspaceId: string;
  readonly isMobile: boolean;
}

function isRestorableLayout(
  layout: SerializedDockview | null,
): layout is SerializedDockview {
  return typeof layout === "object" && layout !== null && "grid" in layout;
}

function loadSavedLayout(api: DockviewApi, layout: SerializedDockview): void {
  try {
    api.fromJSON(layout);
  } catch (error) {
    // dockview throws plain Errors for malformed layouts; start empty instead.
    if (!(error instanceof Error)) throw error;
    api.clear();
  }
}

function defaultChatParams(workspaceId: string): WorkbenchTabParams {
  const { activeWorkspaceId, activeSessionId } = useChatStore.getState();
  const sessionId = activeWorkspaceId === workspaceId ? activeSessionId : null;
  return { kind: "chat", workspaceId, sessionId };
}

export function restoreWorkbenchDockview(
  input: RestoreWorkbenchDockviewInput,
): void {
  const { api, workspaceId, isMobile } = input;
  const savedLayout = useWorkbenchStore
    .getState()
    .getLayout(layoutStorageKey(workspaceId, isMobile));
  if (isRestorableLayout(savedLayout)) loadSavedLayout(api, savedLayout);
  sanitizeRestoredPanels(createDockviewRestoredPanelSource(api), workspaceId);
  const layoutApi = createDockviewLayoutApi(api);
  const chatParams = defaultChatParams(workspaceId);
  const titleLookups = createChatSessionTitleLookups(
    useChatStore.getState().workspaceStates,
  );
  ensureDefaultPanel(
    layoutApi,
    chatParams,
    workbenchTabTitle(chatParams, titleLookups),
  );
  if (isMobile) collapseToSingleGroup(layoutApi);
}

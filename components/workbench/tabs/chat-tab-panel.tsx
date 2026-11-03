"use client";

import { useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import type {
  DockviewApi,
  DockviewPanelApi,
  IDockviewPanelProps,
} from "dockview-react";
import { ChatInterface } from "@/components/chat/chat-interface";
import { syncGlobalChatSessionToTab } from "@/components/workbench/chat-target-sync";
import { useWorkbenchPanelState } from "@/components/workbench/use-workbench-panel-state";
import { WorkbenchPanelFrame } from "@/components/workbench/workbench-panel-frame";
import type { ChatEngine } from "@/lib/engine/types";
import { getEffectiveChatSessionId } from "@/lib/workbench/effective-chat-session";
import { openNewChatInWorkbench } from "@/lib/workbench/open-in-workbench";
import type { WorkbenchTabParams } from "@/lib/workbench/tab-descriptors";
import { useChatStore } from "@/stores/chat-store";
import { useNewChatEngineStore } from "@/stores/new-chat-engine-store";
import { useWorkbenchStore } from "@/stores/workbench-store";

type ChatTabParams = Extract<WorkbenchTabParams, { kind: "chat" }>;

interface ChatTabBodyProps {
  readonly api: DockviewPanelApi;
  readonly containerApi: DockviewApi;
  readonly params: ChatTabParams;
}

function ChatTabBody({ api, containerApi, params }: ChatTabBodyProps) {
  const { workspaceId, sessionId } = params;
  const panelId = api.id;
  const router = useRouter();
  const { isFocused, isVisible } = useWorkbenchPanelState(api, containerApi);
  const isLastFocusedChat = useWorkbenchStore(
    (state) =>
      state.lastFocusedPanelByWorkspace[workspaceId]?.chat?.panelId === panelId,
  );
  // Display-only: deletes are optimistic (Undo) and a cached list can lack a
  // session the live list has, so the tab keeps its binding.
  const effectiveSessionId = useChatStore((state) =>
    getEffectiveChatSessionId(state.workspaceStates[workspaceId], sessionId),
  );

  const handleSessionChosen = useCallback(
    (chosenWorkspaceId: string, chosenSessionId: string) => {
      useWorkbenchStore.getState().requestChatTarget({
        workspaceId: chosenWorkspaceId,
        sessionId: chosenSessionId,
        // A tab never shows another workspace's chat.
        panelId: chosenWorkspaceId === workspaceId ? panelId : null,
      });
    },
    [panelId, workspaceId],
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

  // A focused tab whose session (re)appears takes the global session too.
  useEffect(() => {
    if (!isFocused) return;
    const { activeWorkspaceId, activeSessionId } = useChatStore.getState();
    if (
      activeWorkspaceId === workspaceId &&
      activeSessionId === effectiveSessionId
    ) {
      return;
    }
    syncGlobalChatSessionToTab(workspaceId, effectiveSessionId);
  }, [isFocused, workspaceId, effectiveSessionId]);

  return (
    <ChatInterface
      tabId={panelId}
      workspaceId={workspaceId}
      sessionId={effectiveSessionId}
      isFocused={isFocused}
      isVisible={isVisible}
      isLastFocusedChat={isLastFocusedChat}
      legacyPageMode={false}
      onSessionChosen={handleSessionChosen}
      onNewChatInWorkspace={handleNewChatInWorkspace}
    />
  );
}

export function ChatTabPanel({
  api,
  containerApi,
  params,
}: IDockviewPanelProps<WorkbenchTabParams>) {
  return (
    <WorkbenchPanelFrame api={api}>
      {params.kind === "chat" ? (
        <ChatTabBody api={api} containerApi={containerApi} params={params} />
      ) : null}
    </WorkbenchPanelFrame>
  );
}

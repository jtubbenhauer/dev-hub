import { useMemo } from "react";
import {
  ChatTabProvider,
  type ChatTabContextValue,
} from "@/components/chat/chat-tab-context";
import { McpStatusPanel } from "@/components/chat/mcp-status";
import { SessionFilesPanel } from "@/components/chat/session-files-panel";
import { TaskProgressPanel } from "@/components/chat/task-progress";
import { WorkspaceContextPanel } from "@/components/chat/workspace-context-panel";
import type { ContextSidebarViewProps } from "@/components/workbench/context-sidebar/context-sidebar-views";
import {
  selectSessionMessages,
  selectSessionTodos,
} from "@/lib/chat/session-scoped-selectors";
import { getEffectiveChatSessionId } from "@/lib/workbench/effective-chat-session";
import { useChatStore } from "@/stores/chat-store";
import { useContextSidebarStore } from "@/stores/context-sidebar-store";
import {
  selectLastFocusedChatSessionId,
  useWorkbenchStore,
} from "@/stores/workbench-store";

// The mobile sheet hides a file dialog, so it closes before a file opens.
function closeMobilePanels(): void {
  useContextSidebarStore.getState().setMobileSheetOpen(false);
}

export function StatusView({
  workspaceId,
  workspace,
}: ContextSidebarViewProps) {
  const lastFocusedChatPanelId = useWorkbenchStore(
    (state) =>
      state.lastFocusedPanelByWorkspace[workspaceId]?.chat?.panelId ?? null,
  );
  const lastFocusedSessionId = useWorkbenchStore((state) =>
    selectLastFocusedChatSessionId(state, workspaceId),
  );
  // A deleted session reads as a new chat, as it does in its tab.
  const sessionId = useChatStore((state) =>
    getEffectiveChatSessionId(
      state.workspaceStates[workspaceId],
      lastFocusedSessionId,
    ),
  );
  const selectMessages = useMemo(
    () => selectSessionMessages(workspaceId, sessionId),
    [workspaceId, sessionId],
  );
  const selectTodos = useMemo(
    () => selectSessionTodos(workspaceId, sessionId),
    [workspaceId, sessionId],
  );
  const messages = useChatStore(selectMessages);
  const todos = useChatStore(selectTodos);
  // Scopes the sub-agent file lookup to this session instead of the global one.
  const sessionFilesScope = useMemo<ChatTabContextValue | null>(
    () =>
      lastFocusedChatPanelId === null
        ? null
        : {
            tabId: lastFocusedChatPanelId,
            workspaceId,
            sessionId,
            isFocused: false,
            isLastFocusedChat: false,
            isVisible: true,
          },
    [lastFocusedChatPanelId, workspaceId, sessionId],
  );

  return (
    <div role="region" aria-label="Status">
      <WorkspaceContextPanel workspaceId={workspaceId} workspace={workspace} />
      {todos.length > 0 && (
        <>
          <div className="border-t px-3 py-2">
            <span className="text-muted-foreground text-xs font-medium">
              Task Progress
            </span>
          </div>
          <div className="px-3 pb-3">
            <TaskProgressPanel todos={todos} />
          </div>
        </>
      )}
      <div className="border-t px-3 py-2">
        <span className="text-muted-foreground text-xs font-medium">
          MCP Servers
        </span>
      </div>
      <div className="px-3 pb-3">
        <McpStatusPanel />
      </div>
      <div className="border-t px-3 py-2">
        <span className="text-muted-foreground text-xs font-medium">
          Session Files
        </span>
      </div>
      <div className="px-3 pb-3">
        {sessionFilesScope === null ? (
          <p className="text-muted-foreground px-1.5 py-1 text-xs">
            No chat focused yet
          </p>
        ) : (
          <ChatTabProvider value={sessionFilesScope}>
            <SessionFilesPanel
              messages={messages}
              workspacePath={workspace.path}
              onFileOpen={closeMobilePanels}
            />
          </ChatTabProvider>
        )}
      </div>
    </div>
  );
}

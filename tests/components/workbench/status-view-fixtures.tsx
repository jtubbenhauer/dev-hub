import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { TooltipProvider } from "@/components/ui/tooltip";
import { StatusView } from "@/components/workbench/context-sidebar/status-view";
import type { McpStatusMap } from "@/hooks/use-mcp";
import type { MessageWithParts, Session, Todo } from "@/lib/opencode/types";
import { useChatStore, type WorkspaceState } from "@/stores/chat-store";
import { useWorkbenchStore } from "@/stores/workbench-store";
import { createWorkspace } from "./workspace-fixture";

export const STATUS_WORKSPACE = createWorkspace("ws-1");
export const FOCUSED_CHAT_TAB = "tab-chat-focused";
export const FOCUSED_SESSION_ID = "ses_focused";
export const GLOBAL_SESSION_ID = "ses_global";

export interface ChatSessionSeed {
  readonly id: string;
  readonly parentID?: string;
}

export interface ToolCallSeed {
  readonly sessionId: string;
  readonly tool: string;
  readonly relativePath: string;
}

export interface WorkspaceChatSeed {
  readonly sessions: readonly ChatSessionSeed[];
  readonly messages?: Readonly<Record<string, MessageWithParts[]>>;
  readonly todos?: Readonly<Record<string, Todo[]>>;
}

function chatSession({ id, parentID }: ChatSessionSeed): Session {
  return {
    id,
    projectID: "project-1",
    directory: STATUS_WORKSPACE.path,
    parentID,
    title: `Chat ${id}`,
    version: "1",
    time: { created: 1_000, updated: 1_000 },
  };
}

export function toolCallMessage({
  sessionId,
  tool,
  relativePath,
}: ToolCallSeed): MessageWithParts {
  const messageId = `msg-${sessionId}-${tool}-${relativePath}`;
  return {
    info: {
      id: messageId,
      sessionID: sessionId,
      role: "assistant",
      time: { created: 1 },
      parentID: "",
      modelID: "",
      providerID: "",
      mode: "",
      path: { cwd: STATUS_WORKSPACE.path, root: STATUS_WORKSPACE.path },
      cost: 0,
      tokens: {
        input: 0,
        output: 0,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      },
    },
    parts: [
      {
        id: `${messageId}-part`,
        sessionID: sessionId,
        messageID: messageId,
        type: "tool",
        callID: `${messageId}-call`,
        tool,
        state: {
          status: "completed",
          input: { filePath: `${STATUS_WORKSPACE.path}/${relativePath}` },
          output: "",
          title: "",
          metadata: {},
          time: { start: 1, end: 2 },
        },
      },
    ],
  };
}

export function pendingTodo(content: string): Todo {
  return {
    id: `todo-${content}`,
    content,
    status: "pending",
    priority: "medium",
  };
}

// Each chat edited one file, so a listed path tells which session it came from.
export const TWO_CHATS: WorkspaceChatSeed = {
  sessions: [{ id: FOCUSED_SESSION_ID }, { id: GLOBAL_SESSION_ID }],
  messages: {
    [FOCUSED_SESSION_ID]: [
      toolCallMessage({
        sessionId: FOCUSED_SESSION_ID,
        tool: "edit",
        relativePath: "src/focused.ts",
      }),
    ],
    [GLOBAL_SESSION_ID]: [
      toolCallMessage({
        sessionId: GLOBAL_SESSION_ID,
        tool: "edit",
        relativePath: "src/global.ts",
      }),
    ],
  },
};

function loadedWorkspaceChatState({
  sessions,
  messages = {},
  todos = {},
}: WorkspaceChatSeed): WorkspaceState {
  return {
    sessions: Object.fromEntries(
      sessions.map((seed) => [seed.id, chatSession(seed)]),
    ),
    sessionsLoaded: true,
    messages: { ...messages },
    optimisticMessageIds: {},
    sessionStatuses: {},
    permissions: [],
    questions: [],
    todos: { ...todos },
    sessionAgents: {},
    sessionModels: {},
    sessionVariants: {},
    lastViewedAt: {},
    pinnedSessionIds: new Set(),
    sessionNotes: {},
  };
}

// The global session differs from every tab, so reading it shows wrong data.
export function seedChat(seed: WorkspaceChatSeed): void {
  useChatStore.setState({
    activeWorkspaceId: STATUS_WORKSPACE.id,
    activeSessionId: GLOBAL_SESSION_ID,
    workspaceStates: { [STATUS_WORKSPACE.id]: loadedWorkspaceChatState(seed) },
  });
}

export function focusChatTab(panelId: string, sessionId: string | null): void {
  useWorkbenchStore.getState().setFocusedPanel({
    workspaceId: STATUS_WORKSPACE.id,
    panelId,
    params: { kind: "chat", workspaceId: STATUS_WORKSPACE.id, sessionId },
  });
}

export function renderStatusView() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  // Seeded queries keep settings and the MCP list off the network.
  queryClient.setQueryData(["settings"], {});
  queryClient.setQueryData<McpStatusMap>(
    ["opencode", "mcp", STATUS_WORKSPACE.id],
    { codegraph: { status: "connected" } },
  );
  return render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <StatusView
          workspaceId={STATUS_WORKSPACE.id}
          workspace={STATUS_WORKSPACE}
        />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

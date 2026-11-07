import { useEffect } from "react";
import type { IDockviewPanelHeaderProps } from "dockview-react";
import {
  FileCode2,
  GitCompare,
  MessageSquare,
  Plus,
  TerminalSquare,
  X,
  type LucideIcon,
} from "lucide-react";
import { createDockviewLayoutApi } from "@/components/workbench/dockview-layout-api";
import { requestCloseTab } from "@/components/workbench/workbench-close-tab";
import { TerminalTabRunningIndicator } from "@/components/workbench/tabs/terminal-tab-panel";
import {
  workbenchTabTitle,
  type ChatSessionTitleSource,
} from "@/components/workbench/workbench-tab-title";
import { useEndTerminalSession } from "@/hooks/use-terminal-sessions";
import {
  computeStreamingStatus,
  type SessionScopedChatState,
} from "@/lib/chat/session-scoped-selectors";
import { resolveTabWorkspaceId } from "@/lib/files/save-request";
import type {
  WorkbenchTabKind,
  WorkbenchTabParams,
} from "@/lib/workbench/tab-descriptors";
import { useChatStore, type StreamingStatus } from "@/stores/chat-store";
import { useEditorStore } from "@/stores/editor-store";
import type { OpenFile } from "@/types";

export const TAB_KIND_ICONS: Record<WorkbenchTabKind, LucideIcon> = {
  terminal: TerminalSquare,
  file: FileCode2,
  chat: MessageSquare,
  diff: GitCompare,
  launcher: Plus,
};

type ChatTabActivity = "streaming" | "waiting" | "idle";

type ChatActivitySource = Pick<
  SessionScopedChatState,
  | "workspaceStates"
  | "optimisticStreamingSessionId"
  | "streamingError"
  | "activeWorkspaceId"
  | "activeSessionId"
>;

function assertNever(value: never): never {
  throw new Error(`Unhandled streaming status: ${String(value)}`);
}

function toChatTabActivity(status: StreamingStatus): ChatTabActivity {
  switch (status) {
    case "streaming":
      return "streaming";
    case "waiting":
      return "waiting";
    case "idle":
    case "connecting":
    case "error":
      return "idle";
    default:
      return assertNever(status);
  }
}

// Module-level selectors keep render pure; each returns a primitive for zustand.
function selectChatTabActivity(
  state: ChatActivitySource,
  params: WorkbenchTabParams,
): ChatTabActivity {
  if (params.kind !== "chat" || params.sessionId === null) return "idle";
  const { workspaceId, sessionId } = params;
  const isActiveSession =
    state.activeWorkspaceId === workspaceId &&
    state.activeSessionId === sessionId;
  return toChatTabActivity(
    computeStreamingStatus(state, workspaceId, sessionId, {
      isActiveSession,
      now: Date.now(),
    }),
  );
}

function selectChatSessionTitle(
  state: { readonly workspaceStates: ChatSessionTitleSource },
  params: WorkbenchTabParams,
): string | undefined {
  if (params.kind !== "chat" || params.sessionId === null) return undefined;
  return state.workspaceStates[params.workspaceId]?.sessions[params.sessionId]
    ?.title;
}

function selectIsFileTabDirty(
  state: { readonly openFiles: readonly OpenFile[] },
  params: WorkbenchTabParams,
): boolean {
  if (params.kind !== "file") return false;
  return state.openFiles.some(
    (file) =>
      file.path === params.path &&
      file.isDirty &&
      resolveTabWorkspaceId(file, params.workspaceId) === params.workspaceId,
  );
}

function ChatActivityDot({ activity }: { readonly activity: ChatTabActivity }) {
  switch (activity) {
    case "streaming":
      return (
        <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-emerald-500 motion-reduce:animate-none" />
      );
    case "waiting":
      return <span className="size-1.5 shrink-0 rounded-full bg-amber-500" />;
    case "idle":
      return null;
    default:
      return assertNever(activity);
  }
}

export function WorkbenchTabHeader({
  api,
  containerApi,
  params,
}: IDockviewPanelHeaderProps<WorkbenchTabParams>) {
  const chatSessionTitle = useChatStore((state) =>
    selectChatSessionTitle(state, params),
  );
  const chatActivity = useChatStore((state) =>
    selectChatTabActivity(state, params),
  );
  const isDirty = useEditorStore((state) =>
    selectIsFileTabDirty(state, params),
  );
  const { mutate: endTerminalSession } = useEndTerminalSession();
  const title = workbenchTabTitle(params, {
    getChatSessionTitle: () => chatSessionTitle,
  });
  const TabIcon = TAB_KIND_ICONS[params.kind];

  // Keeps dockview's own title (tab aria-label, saved layout) in step.
  useEffect(() => {
    if (api.title !== title) api.setTitle(title);
  }, [api, title]);

  const handleClose = () => {
    requestCloseTab({
      layoutApi: createDockviewLayoutApi(containerApi),
      panelId: api.id,
      endTerminalSession,
    });
  };

  return (
    <div className="dv-default-tab max-w-56 gap-1.5" title={title}>
      <TabIcon aria-hidden className="size-3.5 shrink-0 opacity-70" />
      <span className="dv-default-tab-content min-w-0 truncate">
        {isDirty && <span className="mr-1 text-orange-400">●</span>}
        {title}
      </span>
      <ChatActivityDot activity={chatActivity} />
      {params.kind === "terminal" && (
        <TerminalTabRunningIndicator
          workspaceId={params.workspaceId}
          sessionId={params.sessionId}
        />
      )}
      <button
        type="button"
        aria-label={`Close ${title}`}
        className="dv-default-tab-action rounded-sm"
        // Capture phase runs before dockview's tab pointerdown, which would activate the tab.
        onPointerDownCapture={(event) => event.preventDefault()}
        onClick={handleClose}
      >
        <X aria-hidden className="size-3" />
      </button>
    </div>
  );
}

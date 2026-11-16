"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertCircle,
  Loader2,
  MessageSquarePlus,
  Pin,
  PinOff,
} from "lucide-react";
import type { TerminalHandle } from "./terminal-panel";
import { TerminalTabBar, type TerminalTabStatus } from "./terminal-tab-bar";
import { useTerminalStore, type TerminalTab } from "@/stores/terminal-store";
import {
  useTerminalScrollbackSetting,
  useTerminalFontSetting,
  useTerminalIdleTimeoutSetting,
  terminalFontFamily,
} from "@/hooks/use-settings";
import {
  useEndTerminalSession,
  useSetTerminalPinned,
  useTerminalSessions,
} from "@/hooks/use-terminal-sessions";
import { terminalSessionKey } from "@/lib/terminal/terminal-protocol";
import {
  formatTerminalOutputForChat,
  queueTerminalOutputForChat,
} from "@/lib/terminal-chat-bridge";
import { cn } from "@/lib/utils";
import { openChatInWorkbench } from "@/lib/workbench/open-in-workbench";

const TerminalPanel = dynamic(() =>
  import("./terminal-panel").then((mod) => mod.TerminalPanel),
);

interface TerminalConfig {
  wsUrl: string;
  cwd: string;
  shellCommand: string | null;
}

const EMPTY_TABS: TerminalTab[] = [];

function useTerminalConfig(workspaceId: string | null, isActive: boolean) {
  const [config, setConfig] = useState<TerminalConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resolvedWorkspaceId, setResolvedWorkspaceId] = useState<string | null>(
    null,
  );

  if (isActive && workspaceId && workspaceId !== resolvedWorkspaceId) {
    setResolvedWorkspaceId(workspaceId);
    setConfig(null);
    setError(null);
  }

  const isLoading =
    isActive &&
    !!workspaceId &&
    resolvedWorkspaceId === workspaceId &&
    !config &&
    !error;

  useEffect(() => {
    if (!isActive || !workspaceId) return;
    if (!isLoading) return;

    let cancelled = false;

    fetch(
      `/api/terminal/resolve?workspaceId=${encodeURIComponent(workspaceId)}`,
    )
      .then(async (res) => {
        if (!res.ok) {
          const body = (await res.json()) as { error?: string };
          throw new Error(
            body.error || `Failed to resolve terminal (${res.status})`,
          );
        }
        return res.json() as Promise<TerminalConfig>;
      })
      .then((data) => {
        if (!cancelled) {
          setConfig(data);
        }
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setError(err.message);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isActive, workspaceId, isLoading]);

  return { config, error, isLoading };
}

interface WorkspaceTerminalProps {
  workspaceId: string | null;
  // The drawer and the /terminal page share tabs, and a session accepts one
  // connection at a time, so only the view on screen passes true.
  isActive: boolean;
  title: ReactNode;
  extraActions?: ReactNode;
  shouldShowLocation?: boolean;
  toolbarClassName?: string;
  bodyClassName?: string;
}

export function WorkspaceTerminal({
  workspaceId,
  isActive,
  title,
  extraActions,
  shouldShowLocation = false,
  toolbarClassName,
  bodyClassName,
}: WorkspaceTerminalProps) {
  const router = useRouter();
  const tabs = useTerminalStore((s) =>
    workspaceId ? (s.tabsByWorkspace[workspaceId] ?? EMPTY_TABS) : EMPTY_TABS,
  );
  const activeSessionId = useTerminalStore((s) =>
    workspaceId ? (s.activeTabByWorkspace[workspaceId] ?? null) : null,
  );
  const unseenActivityKeys = useTerminalStore((s) => s.unseenActivityKeys);
  const { scrollback } = useTerminalScrollbackSetting();
  const { terminalFont } = useTerminalFontSetting();
  const { idleTimeoutMinutes } = useTerminalIdleTimeoutSetting();
  const { data: sessions } = useTerminalSessions({
    isEnabled: isActive && tabs.length > 0,
    refetchIntervalMs: 2000,
  });
  const setPinned = useSetTerminalPinned();
  const endSession = useEndTerminalSession();
  const { config, error, isLoading } = useTerminalConfig(workspaceId, isActive);
  const terminalHandleRef = useRef<TerminalHandle | null>(null);

  useEffect(() => {
    if (isActive && workspaceId) {
      useTerminalStore.getState().ensureTab(workspaceId);
    }
  }, [isActive, workspaceId, tabs.length]);

  const handleTerminalReady = useCallback((handle: TerminalHandle) => {
    terminalHandleRef.current = handle;
  }, []);

  const statusBySessionId: Record<string, TerminalTabStatus> = {};
  if (workspaceId) {
    for (const tab of tabs) {
      const key = terminalSessionKey(workspaceId, tab.sessionId);
      const info = sessions?.find(
        (session) =>
          session.workspaceId === workspaceId &&
          session.sessionId === tab.sessionId,
      );
      statusBySessionId[tab.sessionId] = {
        hasActivity: unseenActivityKeys[key] === true,
        isPinned: info?.isPinned ?? false,
        runningCommand: info?.runningCommand ?? null,
      };
    }
  }
  const activeTab = tabs.find((tab) => tab.sessionId === activeSessionId);
  const isActivePinned = activeSessionId
    ? (statusBySessionId[activeSessionId]?.isPinned ?? false)
    : false;
  const activeSessionExists = sessions?.some(
    (session) =>
      session.workspaceId === workspaceId &&
      session.sessionId === activeSessionId,
  );
  const location = config ? config.shellCommand || config.cwd : null;

  const handleEndTab = (sessionId: string) => {
    if (!workspaceId) return;
    useTerminalStore.getState().closeTab(workspaceId, sessionId);
    endSession.mutate({ workspaceId, sessionId });
  };

  const handleTogglePinned = () => {
    if (!workspaceId || !activeSessionId) return;
    setPinned.mutate({
      workspaceId,
      sessionId: activeSessionId,
      isPinned: !isActivePinned,
    });
  };

  const handleSendToChat = () => {
    if (!workspaceId) return;
    const selection = terminalHandleRef.current?.getSelection() ?? "";
    if (!selection.trim()) {
      toast.info("Select some terminal output first");
      return;
    }
    queueTerminalOutputForChat(
      workspaceId,
      formatTerminalOutputForChat(selection, activeTab?.title ?? "Terminal"),
    );
    useTerminalStore.getState().setOpen(false);
    openChatInWorkbench({
      workspaceId,
      sessionId: null,
      navigate: (href) => router.push(href),
    });
    toast.success("Terminal output added to the chat input");
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className={cn("flex items-center gap-3", toolbarClassName)}>
        {title}
        {workspaceId && (
          <TerminalTabBar
            tabs={tabs}
            activeSessionId={activeSessionId}
            statusBySessionId={statusBySessionId}
            onSelect={(sessionId) =>
              useTerminalStore.getState().setActiveTab(workspaceId, sessionId)
            }
            onEnd={handleEndTab}
            onAdd={() => {
              const store = useTerminalStore.getState();
              const sessionId = store.addTab(workspaceId);
              store.setActiveTab(workspaceId, sessionId);
            }}
          />
        )}
        {shouldShowLocation && location && (
          <span
            title={location}
            className="text-muted-foreground hidden max-w-96 min-w-0 flex-1 truncate text-right font-mono text-xs md:block"
          >
            {location}
          </span>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {activeSessionId && (
            <button
              type="button"
              onClick={handleTogglePinned}
              disabled={!activeSessionExists || setPinned.isPending}
              title={
                isActivePinned
                  ? "Kept alive: this shell keeps running after you close the terminal. Click to let it end when idle."
                  : `Keep alive: by default a closed terminal ends after ${idleTimeoutMinutes === 0 ? "never" : `${idleTimeoutMinutes} min`} idle`
              }
              aria-pressed={isActivePinned}
              className={cn(
                "rounded-sm p-1 opacity-70 transition-opacity hover:opacity-100 disabled:opacity-30",
                isActivePinned && "text-primary opacity-100",
              )}
            >
              {isActivePinned ? (
                <Pin className="size-4" />
              ) : (
                <PinOff className="size-4" />
              )}
              <span className="sr-only">Keep alive</span>
            </button>
          )}
          <button
            type="button"
            onClick={handleSendToChat}
            title="Send selected output to chat"
            className="rounded-sm p-1 opacity-70 transition-opacity hover:opacity-100"
          >
            <MessageSquarePlus className="size-4" />
            <span className="sr-only">Send selection to chat</span>
          </button>
          {extraActions}
        </div>
      </div>

      <div
        className={cn("flex flex-1 flex-col overflow-hidden", bodyClassName)}
      >
        {!workspaceId && (
          <div className="flex flex-1 items-center justify-center">
            <p className="text-muted-foreground text-sm">
              Select a workspace to open a terminal
            </p>
          </div>
        )}

        {workspaceId && isLoading && (
          <div className="flex flex-1 items-center justify-center">
            <Loader2 className="text-muted-foreground size-5 animate-spin" />
          </div>
        )}

        {workspaceId && error && (
          <div className="flex flex-1 items-center justify-center">
            <div className="flex max-w-sm flex-col items-center gap-2 text-center">
              <AlertCircle className="text-muted-foreground size-8" />
              <p className="text-muted-foreground text-sm">{error}</p>
            </div>
          </div>
        )}

        {isActive &&
          workspaceId &&
          activeSessionId &&
          config &&
          !isLoading &&
          !error && (
            <div className="min-h-0 flex-1">
              <TerminalPanel
                key={terminalSessionKey(workspaceId, activeSessionId)}
                wsUrl={config.wsUrl}
                workspaceId={workspaceId}
                sessionId={activeSessionId}
                cwd={config.cwd}
                shellCommand={config.shellCommand}
                scrollback={scrollback}
                fontFamily={terminalFontFamily(terminalFont)}
                idleTimeoutMinutes={idleTimeoutMinutes}
                onReady={handleTerminalReady}
                hasShellFeatures
              />
            </div>
          )}
      </div>
    </div>
  );
}

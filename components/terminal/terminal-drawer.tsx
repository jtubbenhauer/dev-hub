"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertCircle,
  Loader2,
  Maximize2,
  MessageSquarePlus,
  Minimize2,
  Pin,
  PinOff,
  TerminalSquare,
  X,
} from "lucide-react";
import type { TerminalHandle } from "./terminal-panel";
import { TerminalTabBar, type TerminalTabStatus } from "./terminal-tab-bar";
import { TerminalActivityWatcher } from "./terminal-activity-watcher";
import { useDrawerResize } from "./use-drawer-resize";
import { useTerminalStore, type TerminalTab } from "@/stores/terminal-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
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

const TerminalPanel = dynamic(() =>
  import("./terminal-panel").then((mod) => mod.TerminalPanel),
);

interface TerminalConfig {
  wsUrl: string;
  cwd: string;
  shellCommand: string | null;
}

const EMPTY_TABS: TerminalTab[] = [];
const DEFAULT_DRAWER_HEIGHT = "min(60vh, 600px)";
const MAXIMIZED_DRAWER_HEIGHT = "calc(100vh - 3rem)";

function drawerHeight(isMaximized: boolean, heightPx: number | null): string {
  if (isMaximized) return MAXIMIZED_DRAWER_HEIGHT;
  if (heightPx === null) return DEFAULT_DRAWER_HEIGHT;
  return `min(${heightPx}px, ${MAXIMIZED_DRAWER_HEIGHT})`;
}

export function TerminalDrawer() {
  const router = useRouter();
  const pathname = usePathname();
  const isOpen = useTerminalStore((s) => s.isOpen);
  const isMaximized = useTerminalStore((s) => s.isMaximized);
  const drawerHeightPx = useTerminalStore((s) => s.drawerHeightPx);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const activeWorkspace = useWorkspaceStore((s) => s.activeWorkspace);
  const tabs = useTerminalStore((s) =>
    activeWorkspaceId
      ? (s.tabsByWorkspace[activeWorkspaceId] ?? EMPTY_TABS)
      : EMPTY_TABS,
  );
  const activeSessionId = useTerminalStore((s) =>
    activeWorkspaceId
      ? (s.activeTabByWorkspace[activeWorkspaceId] ?? null)
      : null,
  );
  const unseenActivityKeys = useTerminalStore((s) => s.unseenActivityKeys);
  const { scrollback } = useTerminalScrollbackSetting();
  const { terminalFont } = useTerminalFontSetting();
  const { idleTimeoutMinutes } = useTerminalIdleTimeoutSetting();
  const { data: sessions } = useTerminalSessions({
    isEnabled: isOpen && tabs.length > 0,
    refetchIntervalMs: 2000,
  });
  const setPinned = useSetTerminalPinned();
  const endSession = useEndTerminalSession();
  const { isResizing, handleResizePointerDown } = useDrawerResize();
  const terminalHandleRef = useRef<TerminalHandle | null>(null);

  const [config, setConfig] = useState<TerminalConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resolvedWorkspaceId, setResolvedWorkspaceId] = useState<string | null>(
    null,
  );
  const [hasEverOpened, setHasEverOpened] = useState(false);

  if (isOpen && !hasEverOpened) {
    setHasEverOpened(true);
  }

  if (
    isOpen &&
    activeWorkspaceId &&
    activeWorkspaceId !== resolvedWorkspaceId
  ) {
    setResolvedWorkspaceId(activeWorkspaceId);
    setConfig(null);
    setError(null);
  }

  const isLoading =
    isOpen &&
    !!activeWorkspaceId &&
    resolvedWorkspaceId === activeWorkspaceId &&
    !config &&
    !error;

  useEffect(() => {
    if (isOpen && activeWorkspaceId) {
      useTerminalStore.getState().ensureTab(activeWorkspaceId);
    }
  }, [isOpen, activeWorkspaceId, tabs.length]);

  useEffect(() => {
    if (!isOpen || !activeWorkspaceId) return;
    if (!isLoading) return;

    let cancelled = false;

    fetch(
      `/api/terminal/resolve?workspaceId=${encodeURIComponent(activeWorkspaceId)}`,
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
  }, [isOpen, activeWorkspaceId, isLoading]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (
        e.key === "`" &&
        e.ctrlKey &&
        !e.shiftKey &&
        !e.altKey &&
        !e.metaKey
      ) {
        e.preventDefault();
        useTerminalStore.getState().toggle();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleTerminalReady = useCallback((handle: TerminalHandle) => {
    terminalHandleRef.current = handle;
  }, []);

  const statusBySessionId: Record<string, TerminalTabStatus> = {};
  if (activeWorkspaceId) {
    for (const tab of tabs) {
      const key = terminalSessionKey(activeWorkspaceId, tab.sessionId);
      const info = sessions?.find(
        (session) =>
          session.workspaceId === activeWorkspaceId &&
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
      session.workspaceId === activeWorkspaceId &&
      session.sessionId === activeSessionId,
  );

  const handleEndTab = (sessionId: string) => {
    if (!activeWorkspaceId) return;
    useTerminalStore.getState().closeTab(activeWorkspaceId, sessionId);
    endSession.mutate({ workspaceId: activeWorkspaceId, sessionId });
  };

  const handleTogglePinned = () => {
    if (!activeWorkspaceId || !activeSessionId) return;
    setPinned.mutate({
      workspaceId: activeWorkspaceId,
      sessionId: activeSessionId,
      isPinned: !isActivePinned,
    });
  };

  const handleSendToChat = () => {
    if (!activeWorkspaceId) return;
    const selection = terminalHandleRef.current?.getSelection() ?? "";
    if (!selection.trim()) {
      toast.info("Select some terminal output first");
      return;
    }
    queueTerminalOutputForChat(
      activeWorkspaceId,
      formatTerminalOutputForChat(selection, activeTab?.title ?? "Terminal"),
    );
    useTerminalStore.getState().setOpen(false);
    if (!pathname.startsWith("/chat")) router.push("/chat");
    toast.success("Terminal output added to the chat input");
  };

  const closeDrawer = () => useTerminalStore.getState().setOpen(false);

  return (
    <>
      <TerminalActivityWatcher />
      {(hasEverOpened || isOpen) && (
        <>
          {isOpen && (
            <button
              type="button"
              tabIndex={-1}
              className="animate-in fade-in-0 fixed inset-0 z-50 cursor-default appearance-none border-none bg-black/50 p-0"
              onClick={closeDrawer}
            />
          )}

          <div
            className={cn(
              "bg-background fixed inset-x-0 bottom-0 z-50 flex flex-col border-t shadow-lg",
              !isResizing &&
                "transition-[translate,height] duration-300 ease-in-out",
              isOpen ? "translate-y-0" : "translate-y-full",
            )}
            style={{ height: drawerHeight(isMaximized, drawerHeightPx) }}
          >
            <div
              role="separator"
              aria-orientation="horizontal"
              aria-label="Resize terminal"
              title="Drag to resize, double-click to maximize"
              onPointerDown={handleResizePointerDown}
              onDoubleClick={() =>
                useTerminalStore.getState().setMaximized(!isMaximized)
              }
              className="hover:bg-primary/40 absolute inset-x-0 -top-1 h-2 cursor-row-resize"
            />
            <div className="flex items-center gap-3 px-4 pt-3">
              <div className="flex shrink-0 items-center gap-2">
                <div className="flex items-center gap-1.5 text-sm font-semibold">
                  <TerminalSquare className="size-3.5" />
                  Terminal
                </div>
                {activeWorkspace && (
                  <span className="text-muted-foreground text-xs">
                    {activeWorkspace.name}
                    {activeWorkspace.backend === "remote" && (
                      <span className="ml-1 text-blue-500">(remote)</span>
                    )}
                  </span>
                )}
              </div>
              {activeWorkspaceId && (
                <TerminalTabBar
                  tabs={tabs}
                  activeSessionId={activeSessionId}
                  statusBySessionId={statusBySessionId}
                  onSelect={(sessionId) =>
                    useTerminalStore
                      .getState()
                      .setActiveTab(activeWorkspaceId, sessionId)
                  }
                  onEnd={handleEndTab}
                  onAdd={() => {
                    const store = useTerminalStore.getState();
                    const sessionId = store.addTab(activeWorkspaceId);
                    store.setActiveTab(activeWorkspaceId, sessionId);
                  }}
                />
              )}
              <div className="ml-auto flex shrink-0 items-center gap-1">
                {activeSessionId && (
                  <button
                    type="button"
                    onClick={handleTogglePinned}
                    disabled={!activeSessionExists || setPinned.isPending}
                    title={
                      isActivePinned
                        ? "Kept alive: this shell keeps running after you close the drawer. Click to let it end when idle."
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
                <button
                  type="button"
                  onClick={() =>
                    useTerminalStore.getState().setMaximized(!isMaximized)
                  }
                  title={isMaximized ? "Restore size" : "Maximize"}
                  className="rounded-sm p-1 opacity-70 transition-opacity hover:opacity-100"
                >
                  {isMaximized ? (
                    <Minimize2 className="size-4" />
                  ) : (
                    <Maximize2 className="size-4" />
                  )}
                  <span className="sr-only">
                    {isMaximized ? "Restore size" : "Maximize"}
                  </span>
                </button>
                <span className="text-muted-foreground px-1 font-mono text-xs">
                  Ctrl+`
                </span>
                <button
                  type="button"
                  onClick={closeDrawer}
                  className="rounded-sm p-1 opacity-70 transition-opacity hover:opacity-100"
                >
                  <X className="size-4" />
                  <span className="sr-only">Close</span>
                </button>
              </div>
            </div>

            <div className="flex flex-1 flex-col overflow-hidden px-4 pt-2 pb-4">
              {!activeWorkspaceId && (
                <div className="flex flex-1 items-center justify-center">
                  <p className="text-muted-foreground text-sm">
                    Select a workspace to open a terminal
                  </p>
                </div>
              )}

              {activeWorkspaceId && isLoading && (
                <div className="flex flex-1 items-center justify-center">
                  <Loader2 className="text-muted-foreground size-5 animate-spin" />
                </div>
              )}

              {activeWorkspaceId && error && (
                <div className="flex flex-1 items-center justify-center">
                  <div className="flex max-w-sm flex-col items-center gap-2 text-center">
                    <AlertCircle className="text-muted-foreground size-8" />
                    <p className="text-muted-foreground text-sm">{error}</p>
                  </div>
                </div>
              )}

              {isOpen &&
                activeWorkspaceId &&
                activeSessionId &&
                config &&
                !isLoading &&
                !error && (
                  <div className="min-h-0 flex-1">
                    <TerminalPanel
                      key={terminalSessionKey(
                        activeWorkspaceId,
                        activeSessionId,
                      )}
                      wsUrl={config.wsUrl}
                      workspaceId={activeWorkspaceId}
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
        </>
      )}
    </>
  );
}

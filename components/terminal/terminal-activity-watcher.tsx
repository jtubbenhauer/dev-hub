"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useTerminalSessions } from "@/hooks/use-terminal-sessions";
import {
  useTerminalStore,
  getActiveTerminalKey,
} from "@/stores/terminal-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import {
  computeTerminalActivity,
  formatCommandDuration,
  markTerminalSeen,
  type FinishedTerminalCommand,
} from "@/lib/terminal/terminal-activity";
import { terminalSessionKey } from "@/lib/terminal/terminal-protocol";
import { sendBrowserNotification } from "@/lib/notifications";

const OPEN_POLL_INTERVAL_MS = 2000;
const CLOSED_POLL_INTERVAL_MS = 4000;

function announceFinishedCommand({
  session,
  command,
}: FinishedTerminalCommand) {
  const terminalState = useTerminalStore.getState();
  const workspaceState = useWorkspaceStore.getState();
  const tabTitle =
    terminalState.tabsByWorkspace[session.workspaceId]?.find(
      (tab) => tab.sessionId === session.sessionId,
    )?.title ?? "Terminal";
  const workspaceName =
    workspaceState.workspaces.find((w) => w.id === session.workspaceId)?.name ??
    "workspace";
  const title = `${command.name} finished`;
  const description = `${workspaceName} · ${tabTitle} · took ${formatCommandDuration(command.durationMs)}`;
  const isActiveWorkspace =
    workspaceState.activeWorkspaceId === session.workspaceId;

  toast.success(title, {
    description,
    action: isActiveWorkspace
      ? {
          label: "Show",
          onClick: () => {
            const state = useTerminalStore.getState();
            state.setActiveTab(session.workspaceId, session.sessionId);
            state.setOpen(true);
          },
        }
      : undefined,
  });
  sendBrowserNotification(title, { body: description });
}

export function TerminalActivityWatcher() {
  const hasAnyTabs = useTerminalStore((s) =>
    Object.values(s.tabsByWorkspace).some((tabs) => tabs.length > 0),
  );
  const isOpen = useTerminalStore((s) => s.isOpen);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const activeKey = useTerminalStore((s) =>
    getActiveTerminalKey(s, activeWorkspaceId),
  );
  const visibleKey = isOpen ? activeKey : null;
  const previousVisibleKeyRef = useRef<string | null>(null);

  const { data: sessions } = useTerminalSessions({
    isEnabled: hasAnyTabs,
    refetchIntervalMs: isOpen ? OPEN_POLL_INTERVAL_MS : CLOSED_POLL_INTERVAL_MS,
  });

  // Output the user watched until the moment they looked away is not "new".
  useEffect(() => {
    const previousKey = previousVisibleKeyRef.current;
    if (previousKey && previousKey !== visibleKey) {
      const store = useTerminalStore.getState();
      store.setActivityBaseline(
        markTerminalSeen(store.activityBaseline, previousKey, Date.now()),
      );
    }
    previousVisibleKeyRef.current = visibleKey;
  }, [visibleKey]);

  useEffect(() => {
    if (!sessions) return;
    const focusedVisibleKey =
      typeof document !== "undefined" && document.hasFocus()
        ? visibleKey
        : null;
    const store = useTerminalStore.getState();
    const update = computeTerminalActivity(
      sessions,
      store.activityBaseline,
      focusedVisibleKey,
    );
    store.setActivityBaseline(update.baseline);
    store.setUnseenActivityKeys(update.unseenActivityKeys);
    for (const session of sessions) {
      const key = terminalSessionKey(session.workspaceId, session.sessionId);
      const isKnownTab = store.tabsByWorkspace[session.workspaceId]?.some(
        (tab) => tab.sessionId === session.sessionId,
      );
      if (!isKnownTab && !session.hasExited && !store.endedSessionKeys[key]) {
        store.addTab(session.workspaceId, session.sessionId);
      }
    }
    for (const finished of update.finishedCommands) {
      announceFinishedCommand(finished);
    }
  }, [sessions, visibleKey]);

  return null;
}

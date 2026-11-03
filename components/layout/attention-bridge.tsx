"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { findRootSessionId } from "@/lib/attention/session-tree";
import {
  listVisibleSessions,
  type SessionRef,
} from "@/lib/chat/session-scoped-selectors";
import { setNotificationNavigator } from "@/lib/notifications";
import { WORKBENCH_PATH } from "@/lib/workbench/workbench-href";
import { useAttentionStore } from "@/stores/attention-store";
import { useChatStore } from "@/stores/chat-store";

const CHAT_VIEW_PATHNAMES: readonly string[] = ["/chat", WORKBENCH_PATH];

function listOnScreenChatSessions(): SessionRef[] {
  const { activeWorkspaceId, activeSessionId, visibleSessionKeys } =
    useChatStore.getState();
  const visibleSessions = listVisibleSessions(visibleSessionKeys);
  if (activeWorkspaceId === null || activeSessionId === null) {
    return visibleSessions;
  }
  return [
    { workspaceId: activeWorkspaceId, sessionId: activeSessionId },
    ...visibleSessions,
  ];
}

export function clearVisibleChatSessionsUnseen(): void {
  if (!CHAT_VIEW_PATHNAMES.includes(window.location.pathname)) return;
  if (document.visibilityState !== "visible") return;
  if (!document.hasFocus()) return;

  const { workspaceStates } = useChatStore.getState();
  const { clearUnseen } = useAttentionStore.getState();
  for (const { workspaceId, sessionId } of listOnScreenChatSessions()) {
    const rootSessionId = findRootSessionId(
      workspaceStates[workspaceId]?.sessions ?? {},
      sessionId,
    );
    clearUnseen(workspaceId, sessionId);
    if (rootSessionId !== sessionId) {
      clearUnseen(workspaceId, rootSessionId);
    }
  }
}

export function AttentionBridge() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    setNotificationNavigator((href) => router.push(href));
    return () => setNotificationNavigator(null);
  }, [router]);

  useEffect(() => {
    clearVisibleChatSessionsUnseen();
  }, [pathname]);

  useEffect(() => {
    const unsubscribe = useChatStore.subscribe((state, previous) => {
      if (
        state.activeSessionId !== previous.activeSessionId ||
        state.activeWorkspaceId !== previous.activeWorkspaceId ||
        state.visibleSessionKeys !== previous.visibleSessionKeys
      ) {
        clearVisibleChatSessionsUnseen();
      }
    });
    const handleAttentionCheck = () => clearVisibleChatSessionsUnseen();
    document.addEventListener("visibilitychange", handleAttentionCheck);
    window.addEventListener("focus", handleAttentionCheck);
    return () => {
      unsubscribe();
      document.removeEventListener("visibilitychange", handleAttentionCheck);
      window.removeEventListener("focus", handleAttentionCheck);
    };
  }, []);

  return null;
}

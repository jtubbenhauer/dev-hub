"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { findRootSessionId } from "@/lib/attention/session-tree";
import { setNotificationNavigator } from "@/lib/notifications";
import { useAttentionStore } from "@/stores/attention-store";
import { useChatStore } from "@/stores/chat-store";

export function clearVisibleActiveSessionUnseen(): void {
  if (window.location.pathname !== "/chat") return;
  if (document.visibilityState !== "visible") return;
  if (!document.hasFocus()) return;

  const { activeWorkspaceId, activeSessionId, workspaceStates } =
    useChatStore.getState();
  if (activeWorkspaceId === null || activeSessionId === null) return;

  const rootSessionId = findRootSessionId(
    workspaceStates[activeWorkspaceId]?.sessions ?? {},
    activeSessionId,
  );
  const { clearUnseen } = useAttentionStore.getState();
  clearUnseen(activeWorkspaceId, activeSessionId);
  if (rootSessionId !== activeSessionId) {
    clearUnseen(activeWorkspaceId, rootSessionId);
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
    clearVisibleActiveSessionUnseen();
  }, [pathname]);

  useEffect(() => {
    const unsubscribe = useChatStore.subscribe((state, previous) => {
      if (
        state.activeSessionId !== previous.activeSessionId ||
        state.activeWorkspaceId !== previous.activeWorkspaceId
      ) {
        clearVisibleActiveSessionUnseen();
      }
    });
    const handleAttentionCheck = () => clearVisibleActiveSessionUnseen();
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

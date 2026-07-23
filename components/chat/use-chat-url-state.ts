import {
  createChatHref,
  parseChatUrlState,
  type ChatHrefState,
} from "@/lib/chat-url-state";
import type { SessionAgeFilter } from "@/lib/session-filters";
import { useChatStore } from "@/stores/chat-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";

export interface UseChatUrlStateOptions {
  readonly activeWorkspaceId: string | null;
  readonly activeSessionId: string | null;
  readonly workspaceIds: ReadonlySet<string>;
  readonly isUnifiedMode: boolean;
  readonly groupByWorkspace: boolean;
  readonly sessionAgeFilter: SessionAgeFilter;
  readonly onToggleUnifiedMode: () => void;
  readonly onToggleGroupByWorkspace: () => void;
  readonly onSetSessionAgeFilter: (filter: SessionAgeFilter) => void;
}

export interface ChatUrlStateController {
  readonly pushChatState: (updates: Partial<ChatHrefState>) => void;
}

function getActiveSessionIdForWorkspace(
  workspaceId: string | null,
): string | null {
  if (!workspaceId) return null;
  const chatState = useChatStore.getState();
  const sessionId = chatState.activeSessionId;
  if (!sessionId) return null;
  return chatState.workspaceStates[workspaceId]?.sessions[sessionId]
    ? sessionId
    : null;
}

export function useChatUrlState(
  options: UseChatUrlStateOptions,
): ChatUrlStateController {
  const router = useRouter();
  const searchParams = useSearchParams();
  const searchParamsString = searchParams.toString();
  const lastAppliedSearchParamsRef = useRef<string | null>(null);
  const isApplyingUrlRef = useRef(false);
  const pendingSessionIdRef = useRef<string | null>(null);
  const {
    activeWorkspaceId,
    activeSessionId,
    workspaceIds,
    isUnifiedMode,
    groupByWorkspace,
    sessionAgeFilter,
    onToggleUnifiedMode,
    onToggleGroupByWorkspace,
    onSetSessionAgeFilter,
  } = options;

  useEffect(() => {
    const urlState = parseChatUrlState(new URLSearchParams(searchParamsString));
    const applicationKey = `${searchParamsString}\u0000${urlState.workspaceId ?? activeWorkspaceId ?? ""}\u0000${urlState.sessionId ?? activeSessionId ?? ""}`;
    if (lastAppliedSearchParamsRef.current === applicationKey) return;
    if (urlState.workspaceId && workspaceIds.size === 0) return;
    lastAppliedSearchParamsRef.current = applicationKey;

    if (!urlState.hasChatState) {
      router.replace(
        createChatHref({
          workspaceId: activeWorkspaceId,
          sessionId: getActiveSessionIdForWorkspace(activeWorkspaceId),
          view: isUnifiedMode ? "unified" : "workspace",
          groupByWorkspace,
          age: sessionAgeFilter,
        }),
      );
      return;
    }

    const canApplyWorkspace =
      urlState.workspaceId === null || workspaceIds.has(urlState.workspaceId);
    if (urlState.workspaceId && canApplyWorkspace) {
      const workspaceState = useWorkspaceStore.getState();
      const chatState = useChatStore.getState();
      if (workspaceState.activeWorkspaceId !== urlState.workspaceId) {
        workspaceState.setActiveWorkspaceId(urlState.workspaceId);
      }
      if (chatState.activeWorkspaceId !== urlState.workspaceId) {
        chatState.setActiveWorkspaceId(urlState.workspaceId);
      }
    }

    if (canApplyWorkspace && urlState.sessionId) {
      const chatState = useChatStore.getState();
      if (chatState.activeSessionId !== urlState.sessionId) {
        isApplyingUrlRef.current = true;
        chatState.setActiveSession(urlState.sessionId);
      }
    }

    const shouldUseUnifiedMode = urlState.view === "unified";
    if (urlState.view && shouldUseUnifiedMode !== isUnifiedMode) {
      onToggleUnifiedMode();
    }
    if (
      urlState.groupByWorkspace !== null &&
      urlState.groupByWorkspace !== groupByWorkspace
    ) {
      onToggleGroupByWorkspace();
    }
    if (urlState.age && urlState.age !== sessionAgeFilter) {
      onSetSessionAgeFilter(urlState.age);
    }

    const resolvedSessionId =
      urlState.sessionId ??
      getActiveSessionIdForWorkspace(urlState.workspaceId ?? activeWorkspaceId);
    const shouldCanonicalize =
      !canApplyWorkspace ||
      (urlState.workspaceId === null && activeWorkspaceId !== null) ||
      (urlState.sessionId === null && resolvedSessionId !== null) ||
      urlState.view === null ||
      urlState.groupByWorkspace === null ||
      urlState.age === null;
    if (shouldCanonicalize) {
      router.replace(
        createChatHref({
          workspaceId: canApplyWorkspace
            ? (urlState.workspaceId ?? activeWorkspaceId)
            : activeWorkspaceId,
          sessionId: canApplyWorkspace ? resolvedSessionId : activeSessionId,
          view: urlState.view ?? (isUnifiedMode ? "unified" : "workspace"),
          groupByWorkspace: urlState.groupByWorkspace ?? groupByWorkspace,
          age: urlState.age ?? sessionAgeFilter,
        }),
      );
    }
  }, [
    activeSessionId,
    activeWorkspaceId,
    groupByWorkspace,
    isUnifiedMode,
    onSetSessionAgeFilter,
    onToggleGroupByWorkspace,
    onToggleUnifiedMode,
    router,
    searchParamsString,
    sessionAgeFilter,
    workspaceIds,
  ]);

  useEffect(() => {
    const urlState = parseChatUrlState(new URLSearchParams(searchParamsString));
    if (isApplyingUrlRef.current) {
      if (activeSessionId === urlState.sessionId) {
        isApplyingUrlRef.current = false;
      }
      return;
    }
    if (!urlState.hasChatState || urlState.sessionId === null) return;
    if (activeSessionId === urlState.sessionId) {
      pendingSessionIdRef.current = null;
      return;
    }
    if (pendingSessionIdRef.current === activeSessionId) return;
    if (
      activeSessionId &&
      getActiveSessionIdForWorkspace(activeWorkspaceId) !== activeSessionId
    ) {
      return;
    }

    pendingSessionIdRef.current = activeSessionId;
    router.push(
      createChatHref({
        workspaceId: activeWorkspaceId,
        sessionId: activeSessionId,
        view: isUnifiedMode ? "unified" : "workspace",
        groupByWorkspace,
        age: sessionAgeFilter,
      }),
    );
  }, [
    activeSessionId,
    activeWorkspaceId,
    groupByWorkspace,
    isUnifiedMode,
    router,
    searchParamsString,
    sessionAgeFilter,
  ]);

  const pushChatState = useCallback(
    (updates: Partial<ChatHrefState>) => {
      if (updates.sessionId) {
        pendingSessionIdRef.current = updates.sessionId;
      }
      router.push(
        createChatHref({
          workspaceId:
            updates.workspaceId !== undefined
              ? updates.workspaceId
              : activeWorkspaceId,
          sessionId:
            updates.sessionId !== undefined
              ? updates.sessionId
              : getActiveSessionIdForWorkspace(activeWorkspaceId),
          view: updates.view ?? (isUnifiedMode ? "unified" : "workspace"),
          groupByWorkspace: updates.groupByWorkspace ?? groupByWorkspace,
          age: updates.age ?? sessionAgeFilter,
        }),
      );
    },
    [
      activeWorkspaceId,
      groupByWorkspace,
      isUnifiedMode,
      router,
      sessionAgeFilter,
    ],
  );

  return { pushChatState };
}

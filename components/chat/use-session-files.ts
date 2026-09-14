import { useEffect, useMemo, useRef } from "react";
import {
  extractSessionFilesMulti,
  type SessionFile,
} from "@/lib/chat/extract-session-files";
import { collectDescendantSessionIds } from "@/lib/chat/descendant-sessions";
import type { MessageWithParts } from "@/lib/opencode/types";
import { useChatStore } from "@/stores/chat-store";
import { useWorkspaceStore } from "@/stores/workspace-store";

const MAX_DESCENDANTS = 20;
const EMPTY_MESSAGES: MessageWithParts[] = [];

export interface UseSessionFilesResult {
  files: SessionFile[];
  hasUnloadedHistory: boolean;
}

// Aggregates the Session Files list across the active session AND its
// sub-agent (descendant) sessions. Descendant messages are often pre-seeded as
// empty by the chat store, so this hook force-fetches any descendant that has
// not completed a load (detected via the hasMoreBeforeBySession sentinel) and
// merges everything through extractSessionFilesMulti.
export function useSessionFiles(
  messages: MessageWithParts[],
): UseSessionFilesResult {
  const workspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const activeSessionId = useChatStore((s) => s.activeSessionId);
  const sessions = useChatStore((s) =>
    workspaceId ? s.workspaceStates[workspaceId]?.sessions : undefined,
  );
  const messagesBySession = useChatStore((s) =>
    workspaceId ? s.workspaceStates[workspaceId]?.messages : undefined,
  );
  const hasMoreBeforeBySession = useChatStore((s) => s.hasMoreBeforeBySession);
  const fetchMessages = useChatStore((s) => s.fetchMessages);

  const { ids: descendantIds, truncated } = useMemo(() => {
    if (!workspaceId || !activeSessionId || !sessions) {
      return { ids: [] as string[], truncated: false };
    }
    return collectDescendantSessionIds(
      sessions,
      activeSessionId,
      MAX_DESCENDANTS,
    );
  }, [sessions, activeSessionId, workspaceId]);

  // Tracks descendant ids already requested for the CURRENT workspace+parent
  // context. Reset (never accumulated) when that context changes. Mutated only
  // inside the effect below, per the React Compiler hooks rule.
  const requestedRef = useRef<{ contextKey: string; ids: Set<string> }>({
    contextKey: "",
    ids: new Set<string>(),
  });

  useEffect(() => {
    if (!workspaceId || !activeSessionId) return;
    const contextKey = `${workspaceId}:${activeSessionId}`;
    if (requestedRef.current.contextKey !== contextKey) {
      requestedRef.current = { contextKey, ids: new Set<string>() };
    }
    const requested = requestedRef.current.ids;
    for (const childId of descendantIds) {
      const sentinel = hasMoreBeforeBySession[`${workspaceId}:${childId}`];
      // A boolean sentinel proves a completed fetch. Store-key presence or
      // non-empty messages do NOT — the store pre-seeds [] and skips reloads.
      if (typeof sentinel === "boolean") continue;
      if (requested.has(childId)) continue;
      requested.add(childId);
      void fetchMessages(childId, workspaceId, { force: true });
    }
  }, [
    workspaceId,
    activeSessionId,
    descendantIds,
    hasMoreBeforeBySession,
    fetchMessages,
  ]);

  const files = useMemo(() => {
    const descendantMessageArrays = descendantIds.map(
      (id) => messagesBySession?.[id] ?? EMPTY_MESSAGES,
    );
    return extractSessionFilesMulti([messages, ...descendantMessageArrays]);
  }, [messages, descendantIds, messagesBySession]);

  const hasUnloadedHistory = useMemo(() => {
    if (truncated) return true;
    if (!workspaceId) return false;
    if (activeSessionId) {
      if (
        hasMoreBeforeBySession[`${workspaceId}:${activeSessionId}`] === true
      ) {
        return true;
      }
    }
    for (const childId of descendantIds) {
      if (hasMoreBeforeBySession[`${workspaceId}:${childId}`] === true) {
        return true;
      }
    }
    return false;
  }, [
    truncated,
    workspaceId,
    activeSessionId,
    descendantIds,
    hasMoreBeforeBySession,
  ]);

  return { files, hasUnloadedHistory };
}

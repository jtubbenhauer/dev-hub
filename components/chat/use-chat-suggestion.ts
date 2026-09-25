import { useCallback, useEffect, useMemo, useState } from "react";
import { useChatStore } from "@/stores/chat-store";
import { useChatSuggestionsSetting } from "@/hooks/use-settings";
import { buildSuggestionContext } from "@/lib/chat-suggest/context";
import {
  findCandidateRemainder,
  getLiveCompletionRemainder,
  type LiveCompletion,
} from "@/lib/chat-suggest/match";
import type { MessageWithParts } from "@/lib/opencode/types";

const LIVE_COMPLETION_DEBOUNCE_MS = 150;
const MIN_TYPED_CHARS_FOR_LIVE_COMPLETION = 2;
const MAX_CACHED_REPLY_SETS = 50;
const EMPTY_MESSAGES: MessageWithParts[] = [];

// Survives remounts/session switches so each agent turn is only fetched once
const replySuggestionsByAgentMessageId = new Map<string, string[]>();
let isSuggestionServiceDisabled = false;

function cacheReplySuggestions(agentMessageId: string, replies: string[]) {
  replySuggestionsByAgentMessageId.set(agentMessageId, replies);
  if (replySuggestionsByAgentMessageId.size > MAX_CACHED_REPLY_SETS) {
    const oldestKey = replySuggestionsByAgentMessageId.keys().next().value;
    if (oldestKey !== undefined) {
      replySuggestionsByAgentMessageId.delete(oldestKey);
    }
  }
}

async function postChatSuggest(
  body: Record<string, unknown>,
  signal: AbortSignal,
): Promise<Record<string, unknown> | null> {
  const response = await fetch("/api/chat-suggest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (response.status === 503) {
    isSuggestionServiceDisabled = true;
    return null;
  }
  if (!response.ok) return null;
  return (await response.json()) as Record<string, unknown>;
}

function toContextPayload(
  lastAgentMessage: string,
  recentUserMessagesJson: string,
) {
  return {
    lastAgentMessage,
    recentUserMessages: JSON.parse(recentUserMessagesJson) as string[],
  };
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

interface UseChatSuggestionOptions {
  workspaceId: string | null;
  sessionId: string | null;
  typedText: string;
  isStreaming: boolean;
  isEnabled: boolean;
  isLiveCompletionEnabled: boolean;
}

interface LiveCompletionForMessage extends LiveCompletion {
  agentMessageId: string;
}

export function useChatSuggestion({
  workspaceId,
  sessionId,
  typedText,
  isStreaming,
  isEnabled: isEnabledByCaller,
  isLiveCompletionEnabled,
}: UseChatSuggestionOptions) {
  const { isChatSuggestionsEnabled, isLoading: isLoadingSetting } =
    useChatSuggestionsSetting();
  const isEnabled =
    isEnabledByCaller && isChatSuggestionsEnabled && !isLoadingSetting;
  const messages = useChatStore((state) =>
    workspaceId && sessionId
      ? (state.workspaceStates[workspaceId]?.messages[sessionId] ??
        EMPTY_MESSAGES)
      : EMPTY_MESSAGES,
  );
  const context = useMemo(
    () => (isStreaming ? null : buildSuggestionContext(messages)),
    [isStreaming, messages],
  );
  const agentMessageId = context?.lastAgentMessageId ?? null;
  const lastAgentMessage = context?.lastAgentMessage ?? "";
  // Primitive deps keep in-flight requests alive across unrelated store updates
  const recentUserMessagesJson = JSON.stringify(
    context?.recentUserMessages ?? [],
  );

  const [fetchedReplies, setFetchedReplies] = useState<
    Record<string, string[]>
  >({});
  const [liveCompletion, setLiveCompletion] =
    useState<LiveCompletionForMessage | null>(null);
  const [dismissedForText, setDismissedForText] = useState<string | null>(null);

  const replies = agentMessageId
    ? (fetchedReplies[agentMessageId] ??
      replySuggestionsByAgentMessageId.get(agentMessageId) ??
      [])
    : [];
  const currentLiveCompletion =
    liveCompletion && liveCompletion.agentMessageId === agentMessageId
      ? liveCompletion
      : null;

  // Empty input offers the most likely reply as a whole
  const replyRemainder =
    typedText === ""
      ? (replies[0] ?? null)
      : findCandidateRemainder(typedText, replies);
  const liveRemainder = getLiveCompletionRemainder(
    typedText,
    currentLiveCompletion,
  );
  const suggestionRemainder = replyRemainder ?? liveRemainder;
  const isDismissed = dismissedForText === typedText;
  const ghostText =
    isEnabled && !isDismissed && suggestionRemainder
      ? suggestionRemainder
      : null;

  useEffect(() => {
    if (!isEnabled || !agentMessageId || isSuggestionServiceDisabled) return;
    const contextAgentMessageId = agentMessageId;
    if (replySuggestionsByAgentMessageId.has(contextAgentMessageId)) return;

    const controller = new AbortController();
    postChatSuggest(
      {
        mode: "replies",
        ...toContextPayload(lastAgentMessage, recentUserMessagesJson),
      },
      controller.signal,
    )
      .then((data) => {
        const fetched = Array.isArray(data?.replies)
          ? data.replies.filter(
              (reply): reply is string => typeof reply === "string",
            )
          : [];
        cacheReplySuggestions(contextAgentMessageId, fetched);
        setFetchedReplies((previous) => ({
          ...previous,
          [contextAgentMessageId]: fetched,
        }));
      })
      .catch((error: unknown) => {
        if (!isAbortError(error)) {
          console.warn("[chat-suggest] reply suggestions failed", error);
        }
      });
    return () => controller.abort();
  }, [isEnabled, agentMessageId, lastAgentMessage, recentUserMessagesJson]);

  const needsLiveCompletion =
    isEnabled &&
    isLiveCompletionEnabled &&
    !!agentMessageId &&
    replyRemainder === null &&
    liveRemainder === null &&
    typedText.trim().length >= MIN_TYPED_CHARS_FOR_LIVE_COMPLETION &&
    !typedText.startsWith("/");

  useEffect(() => {
    if (
      !needsLiveCompletion ||
      !agentMessageId ||
      isSuggestionServiceDisabled
    ) {
      return;
    }
    const contextAgentMessageId = agentMessageId;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      postChatSuggest(
        {
          mode: "complete",
          typedText,
          ...toContextPayload(lastAgentMessage, recentUserMessagesJson),
        },
        controller.signal,
      )
        .then((data) => {
          const completion =
            typeof data?.completion === "string" ? data.completion : "";
          if (!completion) return;
          setLiveCompletion({
            agentMessageId: contextAgentMessageId,
            typedText,
            completion,
          });
        })
        .catch((error: unknown) => {
          if (!isAbortError(error)) {
            console.warn("[chat-suggest] live completion failed", error);
          }
        });
    }, LIVE_COMPLETION_DEBOUNCE_MS);
    return () => {
      clearTimeout(timeoutId);
      controller.abort();
    };
  }, [
    needsLiveCompletion,
    agentMessageId,
    lastAgentMessage,
    recentUserMessagesJson,
    typedText,
  ]);

  const dismissSuggestion = useCallback(() => {
    setDismissedForText(typedText);
  }, [typedText]);

  return {
    ghostText,
    replySuggestions: isEnabled ? replies : [],
    dismissSuggestion,
  };
}

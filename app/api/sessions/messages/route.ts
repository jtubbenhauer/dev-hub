import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import {
  resolveOpenCodeTarget,
  authorizeOpenCodeSession,
  OpenCodeTargetError,
} from "@/lib/opencode/proxy-target";
import { fetchWithHeaderTimeout } from "@/lib/opencode/fetch-timeout";
import { truncateMessagesForTransport } from "@/lib/opencode/truncate-messages";
import {
  mergeRecoveredMessages,
  mergeTailWindow,
} from "@/lib/opencode/merge-messages";
import {
  readRecoveredMessages,
  writeRecoveredMessages,
} from "@/lib/opencode/recovered-message-cache";
import {
  readMessageCache,
  writeMessageCache,
  MESSAGE_CACHE_FRESH_MS,
} from "@/lib/opencode/message-cache";
import type { MessageWithParts } from "@/lib/opencode/types";
import { withSessionMessageLock } from "@/lib/opencode/session-message-lock";
import { isMessageWithParts } from "@/lib/opencode/message-validation";
import { purgeMessageHistory } from "@/lib/opencode/message-history-purge";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;
// OpenCode only serves a tail window (`limit` = newest N); its `before` param
// rejects message ids. Paging past an anchor therefore needs a window deep
// enough to contain it, plus a margin for messages filtered out after fetch.
const UPSTREAM_WINDOW_MARGIN = 50;

// Truncation preserves message count and order, so anchors resolve against the
// raw cached array without truncating it first.
function upstreamWindowSize(
  limit: number,
  before: string | null,
  cachedMessages: MessageWithParts[],
): number {
  if (!before) return limit + UPSTREAM_WINDOW_MARGIN;
  const anchorIndex = cachedMessages.findIndex(
    (message) => message.info.id === before,
  );
  // Anchor isn't in what we hold: ask for one extra page and let the
  // ANCHOR_NOT_FOUND path rebase the client if it still falls outside.
  const depthToAnchor =
    anchorIndex === -1 ? limit : cachedMessages.length - anchorIndex;
  return depthToAnchor + limit + UPSTREAM_WINDOW_MARGIN;
}

function isDisplayHistoryMessage(message: MessageWithParts): boolean {
  if (message.parts.length === 0) return false;
  return !message.parts.every((part) => part.type === "compaction");
}

// Upstream fetches happen on the LAN and can still be large, but must not run
// forever.
export const maxDuration = 60;

// Returns a windowed, tool-output-truncated slice of a session's messages so
// neither this server nor the client downloads the whole (potentially 100MB+)
// history. A tail window is fetched from OpenCode, truncated, merged over any
// cached history, then sliced.
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  const url = new URL(request.url);
  const sessionId = url.searchParams.get("sessionId");
  const workspaceId = url.searchParams.get("workspaceId");
  const before = url.searchParams.get("before");
  const forceFresh = url.searchParams.get("fresh") === "1";

  const limitParam = Number(url.searchParams.get("limit"));
  const limit =
    Number.isFinite(limitParam) && limitParam > 0
      ? Math.min(Math.floor(limitParam), MAX_LIMIT)
      : DEFAULT_LIMIT;

  if (!sessionId || !workspaceId) {
    return NextResponse.json(
      { error: "sessionId and workspaceId are required" },
      { status: 400 },
    );
  }
  let target: Awaited<ReturnType<typeof resolveOpenCodeTarget>> | null = null;
  let targetResolutionError: OpenCodeTargetError | null = null;
  try {
    target = await resolveOpenCodeTarget(userId, workspaceId);
  } catch (error) {
    if (error instanceof OpenCodeTargetError) {
      if (error.status === 503) {
        targetResolutionError = error;
      } else {
        return NextResponse.json(
          error.detail
            ? { error: error.message, detail: error.detail }
            : { error: error.message },
          { status: error.status },
        );
      }
    } else {
      throw error;
    }
  }

  return withSessionMessageLock(
    `${userId}:${workspaceId}:${sessionId}`,
    async () => {
      const [cached, recovered] = await Promise.all([
        readMessageCache(userId, sessionId, workspaceId),
        readRecoveredMessages(userId, workspaceId, sessionId),
      ]);
      if (target) {
        try {
          await authorizeOpenCodeSession(target, sessionId);
        } catch (error) {
          if (error instanceof OpenCodeTargetError) {
            if (
              error.status !== 503 ||
              (cached === null && recovered.length === 0)
            ) {
              return NextResponse.json(
                error.detail
                  ? { error: error.message, detail: error.detail }
                  : { error: error.message },
                { status: error.status },
              );
            }
          } else {
            throw error;
          }
        }
      }
      if (
        !target &&
        targetResolutionError &&
        cached === null &&
        recovered.length === 0
      ) {
        return NextResponse.json(
          { error: targetResolutionError.message },
          { status: targetResolutionError.status },
        );
      }
      // An empty cache entry is never trusted as fresh: OpenCode accepts a
      // prompt before persisting it, so a fetch racing that write returns []
      // and would otherwise mask the real messages (and their attachments).
      const cacheFresh =
        cached !== null &&
        cached.messages.length > 0 &&
        Date.now() - cached.cachedAt < MESSAGE_CACHE_FRESH_MS;

      let full: MessageWithParts[];
      let authoritativeIds: Set<string>;
      let cachedAt: number;
      let source: "cache" | "remote" | "stale-cache";
      // Upstream filled the window it was given, so history exists beyond it
      // even when the local slice already reaches index 0.
      let upstreamWindowFull = false;

      if (!target) {
        full = cached ? truncateMessagesForTransport(cached.messages) : [];
        authoritativeIds = new Set(cached?.authoritativeMessageIds ?? []);
        cachedAt = cached?.cachedAt ?? 0;
        source = "stale-cache";
      } else if (cached && cacheFresh && !forceFresh) {
        full = truncateMessagesForTransport(cached.messages);
        authoritativeIds = new Set(cached.authoritativeMessageIds);
        cachedAt = cached.cachedAt;
        source = "cache";
      } else {
        const targetUrl = new URL(
          `/session/${sessionId}/message`,
          target.serverUrl,
        );
        if (target.directory) {
          targetUrl.searchParams.set("directory", target.directory);
        }
        // Unwindowed, this downloads the entire history (48MB+ on long
        // sessions), which cannot finish inside the request timeouts.
        const windowSize = upstreamWindowSize(
          limit,
          before,
          cached?.messages ?? [],
        );
        targetUrl.searchParams.set("limit", String(windowSize));

        try {
          const upstream = await fetchWithHeaderTimeout(
            targetUrl.toString(),
            { headers: { accept: "application/json" } },
            20_000,
          );
          if (!upstream.ok) {
            throw new Error(`OpenCode responded ${upstream.status}`);
          }
          const upstreamBody: unknown = await upstream.json();
          if (!Array.isArray(upstreamBody)) {
            throw new Error("OpenCode returned an invalid message list");
          }
          upstreamWindowFull = upstreamBody.length >= windowSize;
          const remote = upstreamBody.filter(
            (message): message is MessageWithParts =>
              isMessageWithParts(message) &&
              message.info.sessionID === sessionId,
          );
          const remoteMessages = truncateMessagesForTransport(remote);
          authoritativeIds = new Set(
            remoteMessages.map((message) => message.info.id),
          );
          full = cached
            ? mergeTailWindow(
                truncateMessagesForTransport(cached.messages),
                remoteMessages,
              )
            : remoteMessages;
          cachedAt = Date.now();
          source = "remote";
        } catch (error) {
          // Remote unreachable — fall back to any cache we have (even stale) so an
          // offline blip doesn't blank the chat.
          if (cached) {
            full = truncateMessagesForTransport(cached.messages);
            authoritativeIds = new Set(cached.authoritativeMessageIds);
            cachedAt = cached.cachedAt;
            source = "stale-cache";
          } else if (recovered.length > 0) {
            full = [];
            authoritativeIds = new Set();
            cachedAt = 0;
            source = "stale-cache";
          } else {
            const isTimeout =
              error instanceof DOMException && error.name === "TimeoutError";
            return NextResponse.json(
              {
                error: "Failed to load messages",
                detail:
                  error instanceof Error ? error.message : "Unknown error",
              },
              { status: isTimeout ? 504 : 502 },
            );
          }
        }
        if (source === "remote" && full.length > 0) {
          try {
            await writeMessageCache({
              userId,
              sessionId,
              workspaceId,
              messages: full,
              authoritativeMessageIds: [...authoritativeIds],
            });
          } catch (error) {
            console.warn(
              "[chat-recovery] Failed to persist message cache",
              error,
            );
          }
        }
      }

      const reconciledFull = mergeRecoveredMessages(full, recovered);
      if (source === "remote") {
        try {
          await writeRecoveredMessages({
            userId,
            workspaceId,
            sessionId,
            messages: reconciledFull,
          });
        } catch (error) {
          console.warn("[chat-recovery] Failed to persist archive", error);
        }
      }
      full = truncateMessagesForTransport(reconciledFull);
      full = full.filter(isDisplayHistoryMessage);
      const total = full.length;

      let messages: MessageWithParts[];
      let hasMore: boolean;

      if (before) {
        const anchorIndex = full.findIndex((m) => m.info.id === before);
        if (anchorIndex === -1) {
          // The anchor was compacted/reverted away — the client must rebase to a
          // fresh tail rather than guess a slice.
          return NextResponse.json(
            { error: "Anchor not found", code: "ANCHOR_NOT_FOUND" },
            { status: 409 },
          );
        }
        const start = Math.max(0, anchorIndex - limit);
        messages = full.slice(start, anchorIndex);
        hasMore = start > 0 || upstreamWindowFull;
      } else {
        const start = Math.max(0, total - limit);
        messages = full.slice(start);
        hasMore = start > 0 || upstreamWindowFull;
      }

      const recoveredMessageIds = messages
        .map((message) => message.info.id)
        .filter((id) => !authoritativeIds.has(id));

      return NextResponse.json({
        messages,
        hasMore,
        total,
        cachedAt,
        source,
        recoveredMessageIds,
      });
    },
  );
}

// Explicit, user-initiated removal (undo/revert, session delete) is the only
// signal allowed to drop archived history — absence from a capped or offline
// response never is.
export async function DELETE(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const sessionId = url.searchParams.get("sessionId");
  const workspaceId = url.searchParams.get("workspaceId");
  const fromMessageId = url.searchParams.get("from") ?? undefined;
  const exactMessageId = url.searchParams.get("message") ?? undefined;

  if (!sessionId || !workspaceId) {
    return NextResponse.json(
      { error: "sessionId and workspaceId are required" },
      { status: 400 },
    );
  }
  if (fromMessageId && exactMessageId) {
    return NextResponse.json(
      { error: "from and message are mutually exclusive" },
      { status: 400 },
    );
  }

  try {
    await resolveOpenCodeTarget(session.user.id, workspaceId);
  } catch (error) {
    if (error instanceof OpenCodeTargetError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }
    throw error;
  }

  return withSessionMessageLock(
    `${session.user.id}:${workspaceId}:${sessionId}`,
    async () => {
      const purged = purgeMessageHistory({
        userId: session.user.id,
        workspaceId,
        sessionId,
        fromMessageId,
        exactMessageId,
      });
      return NextResponse.json({ purged });
    },
  );
}

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import {
  resolveOpenCodeTarget,
  OpenCodeTargetError,
} from "@/lib/opencode/proxy-target";
import { fetchWithHeaderTimeout } from "@/lib/opencode/fetch-timeout";
import { truncateMessagesForTransport } from "@/lib/opencode/truncate-messages";
import {
  readMessageCache,
  writeMessageCache,
  MESSAGE_CACHE_FRESH_MS,
} from "@/lib/opencode/message-cache";
import type { MessageWithParts } from "@/lib/opencode/types";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

// Full-session fetches happen on the LAN and can be large, but must not run
// forever.
export const maxDuration = 60;

// Returns a windowed, tool-output-truncated slice of a session's messages so
// mobile clients never download the whole (potentially 100MB+) history. The
// full array is fetched once on the LAN, truncated, cached, then sliced.
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

  let target;
  try {
    target = await resolveOpenCodeTarget(userId, workspaceId);
  } catch (error) {
    if (error instanceof OpenCodeTargetError) {
      return NextResponse.json(
        error.detail
          ? { error: error.message, detail: error.detail }
          : { error: error.message },
        { status: error.status },
      );
    }
    throw error;
  }

  const cached = await readMessageCache(userId, sessionId, workspaceId);
  const cacheFresh =
    cached !== null && Date.now() - cached.cachedAt < MESSAGE_CACHE_FRESH_MS;

  let full: MessageWithParts[];
  let cachedAt: number;
  let source: "cache" | "remote" | "stale-cache";

  if (cached && cacheFresh && !forceFresh) {
    full = truncateMessagesForTransport(cached.messages);
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

    try {
      const upstream = await fetchWithHeaderTimeout(
        targetUrl.toString(),
        { headers: { accept: "application/json" } },
        20_000,
      );
      if (!upstream.ok) {
        throw new Error(`OpenCode responded ${upstream.status}`);
      }
      const remote = (await upstream.json()) as MessageWithParts[];
      full = truncateMessagesForTransport(remote);
      cachedAt = Date.now();
      source = "remote";
      await writeMessageCache(userId, sessionId, workspaceId, full);
    } catch (error) {
      // Remote unreachable — fall back to any cache we have (even stale) so an
      // offline blip doesn't blank the chat.
      if (cached) {
        full = truncateMessagesForTransport(cached.messages);
        cachedAt = cached.cachedAt;
        source = "stale-cache";
      } else {
        const isTimeout =
          error instanceof DOMException && error.name === "TimeoutError";
        return NextResponse.json(
          {
            error: "Failed to load messages",
            detail: error instanceof Error ? error.message : "Unknown error",
          },
          { status: isTimeout ? 504 : 502 },
        );
      }
    }
  }

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
    hasMore = start > 0;
  } else {
    const start = Math.max(0, total - limit);
    messages = full.slice(start);
    hasMore = start > 0;
  }

  return NextResponse.json({ messages, hasMore, total, cachedAt, source });
}

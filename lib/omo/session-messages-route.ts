import { and, eq } from "drizzle-orm";
import { cachedMessages } from "@/drizzle/schema";
import { db } from "@/lib/db";
import { handleOmoRead } from "@/lib/omo/facade/read";
import type { OmoReadWorkspace } from "@/lib/omo/facade/read-types";
import {
  omoSessionNotFoundResponse,
  resolveOmoWorkspaceOrResponse,
  toOmoWorkspace,
} from "@/lib/omo/route-dispatch";
import { mergeTailWindow } from "@/lib/opencode/merge-messages";
import {
  MESSAGE_CACHE_FRESH_MS,
  readMessageCache,
  writeMessageCache,
} from "@/lib/opencode/message-cache";
import { isMessageWithParts } from "@/lib/opencode/message-validation";
import { withSessionMessageLock } from "@/lib/opencode/session-message-lock";
import { truncateMessagesForTransport } from "@/lib/opencode/truncate-messages";
import type { MessageWithParts } from "@/lib/opencode/types";

const FACADE_MAX_LIMIT = 1_000;
const WINDOW_MARGIN = 50;

export type OmoMessagesRequest = {
  readonly userId: string;
  readonly workspaceId: string;
  readonly sessionId: string;
  readonly before: string | null;
  readonly limit: number;
  readonly isFresh: boolean;
  readonly isReplace: boolean;
};

type FacadeWindow =
  | { readonly ok: true; readonly messages: MessageWithParts[] }
  | { readonly ok: false; readonly response: Response };

function isDisplayHistoryMessage(message: MessageWithParts): boolean {
  if (message.parts.length === 0) return false;
  return !message.parts.every((part) => part.type === "compaction");
}

async function fetchFacadeWindow(
  workspace: OmoReadWorkspace,
  input: OmoMessagesRequest,
  query: URLSearchParams,
): Promise<FacadeWindow> {
  const response = await handleOmoRead({
    method: "GET",
    path: `/session/${input.sessionId}/message`,
    query,
    workspace,
    userId: input.userId,
  });
  if (!response.ok) return { ok: false, response };
  const body: unknown = await response.json();
  if (!Array.isArray(body)) {
    return {
      ok: false,
      response: Response.json(
        { error: "Failed to load messages" },
        { status: 502 },
      ),
    };
  }
  const messages = body.filter(
    (message): message is MessageWithParts =>
      isMessageWithParts(message) && message.info.sessionID === input.sessionId,
  );
  return { ok: true, messages: truncateMessagesForTransport(messages) };
}

function rewriteMessageCache(
  input: OmoMessagesRequest,
  messages: MessageWithParts[],
): void {
  const { userId, workspaceId, sessionId } = input;
  db.transaction((transaction) => {
    transaction
      .delete(cachedMessages)
      .where(
        and(
          eq(cachedMessages.userId, userId),
          eq(cachedMessages.workspaceId, workspaceId),
          eq(cachedMessages.sessionId, sessionId),
        ),
      )
      .run();
    if (messages.length === 0) return;
    transaction
      .insert(cachedMessages)
      .values({
        sessionId,
        workspaceId,
        userId,
        messagesJson: JSON.stringify(messages),
        authoritativeMessageIdsJson: JSON.stringify(
          messages.map((message) => message.info.id),
        ),
        cachedAt: Date.now(),
      })
      .run();
  });
}

async function replaceWindow(
  workspace: OmoReadWorkspace,
  input: OmoMessagesRequest,
): Promise<Response> {
  const query = new URLSearchParams({ limit: String(input.limit) });
  if (input.before) query.set("before", input.before);
  const remote = await fetchFacadeWindow(workspace, input, query);
  if (!remote.ok) return remote.response;
  rewriteMessageCache(input, remote.messages);
  return Response.json({
    messages: remote.messages,
    hasMore: remote.messages.length >= input.limit,
    total: remote.messages.length,
    cachedAt: Date.now(),
    source: "remote",
    recoveredMessageIds: [],
  });
}

function windowSize(
  input: OmoMessagesRequest,
  cachedMessages: MessageWithParts[],
): number {
  const anchorIndex = input.before
    ? cachedMessages.findIndex((message) => message.info.id === input.before)
    : -1;
  const depthToAnchor = !input.before
    ? 0
    : anchorIndex === -1
      ? input.limit
      : cachedMessages.length - anchorIndex;
  return Math.min(
    FACADE_MAX_LIMIT,
    depthToAnchor + input.limit + WINDOW_MARGIN,
  );
}

async function mergedWindow(
  workspace: OmoReadWorkspace,
  input: OmoMessagesRequest,
): Promise<Response> {
  const { userId, workspaceId, sessionId, before, limit } = input;
  const cached = await readMessageCache(userId, sessionId, workspaceId);
  const isCacheFresh =
    cached !== null &&
    cached.messages.length > 0 &&
    Date.now() - cached.cachedAt < MESSAGE_CACHE_FRESH_MS;

  let full: MessageWithParts[];
  let cachedAt: number;
  let source: "cache" | "remote" | "stale-cache";
  let isUpstreamWindowFull = false;

  if (cached && isCacheFresh && !input.isFresh) {
    full = truncateMessagesForTransport(cached.messages);
    cachedAt = cached.cachedAt;
    source = "cache";
  } else {
    const size = windowSize(input, cached?.messages ?? []);
    const query = new URLSearchParams({ limit: String(size) });
    const remote = await fetchFacadeWindow(workspace, input, query);
    if (remote.ok) {
      isUpstreamWindowFull = remote.messages.length >= size;
      full = cached
        ? mergeTailWindow(
            truncateMessagesForTransport(cached.messages),
            remote.messages,
          )
        : remote.messages;
      cachedAt = Date.now();
      source = "remote";
      if (full.length > 0) {
        try {
          await writeMessageCache({
            userId,
            sessionId,
            workspaceId,
            messages: full,
            authoritativeMessageIds: remote.messages.map(
              (message) => message.info.id,
            ),
          });
        } catch (error) {
          console.warn("[omo-messages] Failed to persist message cache", error);
        }
      }
    } else if (cached) {
      full = truncateMessagesForTransport(cached.messages);
      cachedAt = cached.cachedAt;
      source = "stale-cache";
    } else {
      return remote.response;
    }
  }

  full = full.filter(isDisplayHistoryMessage);
  const total = full.length;
  let start: number;
  let end: number;
  if (before) {
    end = full.findIndex((message) => message.info.id === before);
    if (end === -1) {
      return Response.json(
        { error: "Anchor not found", code: "ANCHOR_NOT_FOUND" },
        { status: 409 },
      );
    }
    start = Math.max(0, end - limit);
  } else {
    end = total;
    start = Math.max(0, total - limit);
  }

  return Response.json({
    messages: full.slice(start, end),
    hasMore: start > 0 || isUpstreamWindowFull,
    total,
    cachedAt,
    source,
    recoveredMessageIds: [],
  });
}

export async function getOmoSessionMessages(
  input: OmoMessagesRequest,
): Promise<Response> {
  const resolved = await resolveOmoWorkspaceOrResponse(
    input.userId,
    input.workspaceId,
  );
  if (resolved instanceof Response) return resolved;
  if (!input.sessionId.startsWith("omo_")) return omoSessionNotFoundResponse();
  const workspace = toOmoWorkspace(resolved);
  return withSessionMessageLock(
    `${input.userId}:${input.workspaceId}:${input.sessionId}`,
    () =>
      input.isReplace
        ? replaceWindow(workspace, input)
        : mergedWindow(workspace, input),
  );
}

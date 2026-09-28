import { createDialogAdapter } from "@/lib/omo/adapter/dialogs";
import {
  entriesToMessages,
  windowMessages,
} from "@/lib/omo/adapter/entries-to-messages";
import { getOmoIndexRow } from "@/lib/omo/session-index";
import { activeBranch, type SessionEntry } from "@/lib/omo/sessions-on-disk";
import {
  isHistoryFallbackError,
  replacementId,
  responseForOmoReadError,
} from "@/lib/omo/facade/read-errors";
import { parseRpcEntriesResponse } from "@/lib/omo/facade/read-message-entries";
import { getOmoDialogLedger } from "@/lib/omo/facade/read-runtime";
import {
  jsonResponse,
  sessionNotFoundResponse,
  type OmoReadContext,
} from "@/lib/omo/facade/read-types";

const DEFAULT_MESSAGE_LIMIT = 100;
const MAX_MESSAGE_LIMIT = 1_000;

function messageLimit(query: URLSearchParams): number {
  const value = Number(query.get("limit") ?? DEFAULT_MESSAGE_LIMIT);
  if (!Number.isFinite(value)) return DEFAULT_MESSAGE_LIMIT;
  return Math.min(MAX_MESSAGE_LIMIT, Math.max(0, Math.floor(value)));
}

function branchForLeaf(
  entries: readonly SessionEntry[],
  leafId: string | null | undefined,
): SessionEntry[] {
  if (leafId === null || leafId === undefined) return [];
  return activeBranch(entries, leafId);
}

function responseForMessages(
  entries: SessionEntry[],
  rawId: string,
  context: OmoReadContext,
  query: URLSearchParams,
): Response {
  const messages = entriesToMessages(entries, {
    sessionId: `omo_${rawId}`,
    workspacePath: context.workspace.path,
    skillPrefixes: [],
  });
  return jsonResponse(
    windowMessages(messages, {
      limit: messageLimit(query),
      before: query.get("before"),
    }),
  );
}

async function fileFallback(
  context: OmoReadContext,
  rawId: string,
  query: URLSearchParams,
): Promise<Response> {
  const [row, entries] = await Promise.all([
    getOmoIndexRow(context.workspace.id, rawId),
    context.source.readEntries(rawId),
  ]);
  const fallbackLeaf = entries.at(-1)?.id;
  const leafId = row?.leafEntryId ?? fallbackLeaf;
  return responseForMessages(
    branchForLeaf(entries, leafId),
    rawId,
    context,
    query,
  );
}

function ingestPendingQuestions(
  context: OmoReadContext,
  rawId: string,
  binding: Awaited<ReturnType<OmoReadContext["runtime"]["registry"]["attach"]>>,
): void {
  const dialogs = createDialogAdapter({
    ledger: getOmoDialogLedger(context.runtime),
    routingHandle: binding.routingHandle,
    durableId: rawId,
    workspaceId: context.workspace.id,
    sendResponse: async () => undefined,
  });
  dialogs.ingestPendingQuestions(
    binding.openedState.record["pendingQuestions"],
  );
}

export async function readOmoMessages(
  context: OmoReadContext,
  rawId: string,
  query: URLSearchParams,
): Promise<Response> {
  const row = await getOmoIndexRow(context.workspace.id, rawId);
  if (row === null && !(await context.source.authorizeSession(rawId))) {
    return sessionNotFoundResponse();
  }
  try {
    const binding = await context.runtime.registry.attach({
      workspace: context.workspace,
      durableId: rawId,
    });
    await binding.ready;
    ingestPendingQuestions(context, rawId, binding);
    const snapshot = parseRpcEntriesResponse(
      await context.runtime.registry.request(binding, { type: "get_entries" }),
    );
    return responseForMessages(
      branchForLeaf(snapshot.entries, snapshot.leafId),
      rawId,
      context,
      query,
    );
  } catch (error) {
    if (replacementId(error) !== undefined) {
      const response = responseForOmoReadError(error);
      if (response !== null) return response;
    }
    if (isHistoryFallbackError(error)) {
      return fileFallback(context, rawId, query);
    }
    throw error;
  }
}

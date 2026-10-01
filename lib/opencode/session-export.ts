import { resolveWorkspaceEngine } from "@/lib/engine/resolve-engine";
import { handleOmoRead } from "@/lib/omo/facade/read";
import { toOmoWorkspace } from "@/lib/omo/route-dispatch";
import { fetchWithHeaderTimeout } from "@/lib/opencode/fetch-timeout";
import { isMessageWithParts } from "@/lib/opencode/message-validation";
import {
  authorizeOpenCodeSession,
  OpenCodeTargetError,
  resolveOmoWorkspace,
  resolveOpenCodeTarget,
} from "@/lib/opencode/proxy-target";
import type {
  TranscriptProvider,
  TranscriptSession,
} from "@/lib/opencode/session-transcript";
import type { MessageWithParts } from "@/lib/opencode/types";
import type { Workspace } from "@/types";

// Unlike the windowed chat routes, export asks OpenCode for the whole
// untruncated history, which it can take a long time to serialise.
const EXPORT_HEADER_TIMEOUT_MS = 120_000;

// The omo facade serves at most this many messages per request (newest
// first), so its full history has to be paged backwards with `before`.
const OMO_HISTORY_PAGE_SIZE = 1_000;

export interface SessionExportTarget {
  readonly userId: string;
  readonly workspaceId: string;
  readonly sessionId: string;
}

export interface SessionExportSource {
  readonly workspace: Workspace;
  readonly session: TranscriptSession;
  readonly messages: readonly MessageWithParts[];
  readonly providers: readonly TranscriptProvider[];
}

interface UpstreamConnection {
  readonly workspace: Workspace;
  readonly read: (path: string) => Promise<Response>;
  readonly readHistory: (messagesPath: string) => Promise<unknown[]>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function invalidUpstream(detail: string): OpenCodeTargetError {
  return new OpenCodeTargetError(502, "Failed to load session", detail);
}

async function parseUpstreamJson(
  response: Response,
  path: string,
): Promise<unknown> {
  if (response.status === 404) {
    throw new OpenCodeTargetError(404, "Session not found");
  }
  if (!response.ok) {
    throw invalidUpstream(`GET ${path} responded ${response.status}`);
  }
  return response.json();
}

function parseMessageList(value: unknown): unknown[] {
  if (!Array.isArray(value)) {
    throw invalidUpstream("Upstream returned an invalid message list");
  }
  return value;
}

function readMessageId(value: unknown): string {
  if (
    isRecord(value) &&
    isRecord(value.info) &&
    typeof value.info.id === "string"
  ) {
    return value.info.id;
  }
  throw invalidUpstream("Upstream returned an invalid message list");
}

async function readOmoHistory(
  readPage: (query: URLSearchParams) => Promise<Response>,
  messagesPath: string,
): Promise<unknown[]> {
  const pagesOldestFirst: unknown[][] = [];
  let before: string | null = null;
  for (;;) {
    const query = new URLSearchParams({ limit: String(OMO_HISTORY_PAGE_SIZE) });
    if (before !== null) query.set("before", before);
    const page = parseMessageList(
      await parseUpstreamJson(await readPage(query), messagesPath),
    );
    pagesOldestFirst.unshift(page);
    if (page.length < OMO_HISTORY_PAGE_SIZE) return pagesOldestFirst.flat();
    before = readMessageId(page[0]);
  }
}

async function connectUpstream(
  target: SessionExportTarget,
): Promise<UpstreamConnection> {
  const { userId, workspaceId, sessionId } = target;
  const engine = await resolveWorkspaceEngine(userId, workspaceId);

  if (engine === "omo") {
    if (sessionId.startsWith("ses_")) {
      throw new OpenCodeTargetError(404, "Session not found");
    }
    const workspace = await resolveOmoWorkspace(userId, workspaceId);
    const omoWorkspace = toOmoWorkspace(workspace);
    const readOmo = (path: string, query: URLSearchParams) =>
      handleOmoRead({
        method: "GET",
        path,
        query,
        workspace: omoWorkspace,
        userId,
      });
    return {
      workspace,
      read: (path) => readOmo(path, new URLSearchParams()),
      readHistory: (messagesPath) =>
        readOmoHistory((query) => readOmo(messagesPath, query), messagesPath),
    };
  }

  if (sessionId.startsWith("omo_")) {
    throw new OpenCodeTargetError(404, "Session not found");
  }
  const openCodeTarget = await resolveOpenCodeTarget(userId, workspaceId);
  const { workspace, serverUrl, directory } = openCodeTarget;
  if (!workspace) {
    throw new OpenCodeTargetError(404, "Workspace not found");
  }
  await authorizeOpenCodeSession(openCodeTarget, sessionId);
  const read = (path: string) => {
    const url = new URL(path, serverUrl);
    if (directory) url.searchParams.set("directory", directory);
    return fetchWithHeaderTimeout(
      url.toString(),
      { headers: { accept: "application/json" } },
      EXPORT_HEADER_TIMEOUT_MS,
    );
  };
  return {
    workspace,
    read,
    // Without `limit` OpenCode returns the entire history in one response.
    readHistory: async (messagesPath) =>
      parseMessageList(
        await parseUpstreamJson(await read(messagesPath), messagesPath),
      ),
  };
}

function parseSession(value: unknown): TranscriptSession {
  if (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    isRecord(value.time) &&
    typeof value.time.created === "number" &&
    typeof value.time.updated === "number"
  ) {
    return {
      id: value.id,
      title: value.title,
      time: { created: value.time.created, updated: value.time.updated },
    };
  }
  throw invalidUpstream("Upstream returned an invalid session");
}

function isTranscriptProvider(value: unknown): value is TranscriptProvider {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    isRecord(value.models) &&
    Object.values(value.models).every(
      (model) => isRecord(model) && typeof model.name === "string",
    )
  );
}

// Model names only decorate assistant headers. Without them the transcript
// falls back to model IDs, which is what the TUI does too.
async function readProviders(
  read: UpstreamConnection["read"],
): Promise<TranscriptProvider[]> {
  try {
    const response = await read("/config/providers");
    if (!response.ok) return [];
    const body: unknown = await response.json();
    return isRecord(body) && Array.isArray(body.providers)
      ? body.providers.filter(isTranscriptProvider)
      : [];
  } catch (error) {
    if (error instanceof Error) return [];
    throw error;
  }
}

export async function loadSessionForExport(
  target: SessionExportTarget,
): Promise<SessionExportSource> {
  const { workspace, read, readHistory } = await connectUpstream(target);
  const sessionPath = `/session/${encodeURIComponent(target.sessionId)}`;
  const [sessionBody, history, providers] = await Promise.all([
    read(sessionPath).then((response) =>
      parseUpstreamJson(response, sessionPath),
    ),
    readHistory(`${sessionPath}/message`),
    readProviders(read),
  ]);
  return {
    workspace,
    session: parseSession(sessionBody),
    messages: history.filter(
      (message): message is MessageWithParts =>
        isMessageWithParts(message) &&
        message.info.sessionID === target.sessionId,
    ),
    providers,
  };
}

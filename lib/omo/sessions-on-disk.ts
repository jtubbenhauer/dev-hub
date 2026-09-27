import { createReadStream, type Dirent } from "node:fs";
import { open, readdir, realpath, stat } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";

const HEADER_SCAN_CAP_BYTES = 1_048_576;
const ENTRIES_TOTAL_CAP_BYTES = 67_108_864;
const TITLE_MAX_CHARS = 80;
const EPOCH_SECONDS_HEURISTIC_THRESHOLD = 1e12;

export interface OmoSessionHeader {
  readonly type: "session";
  readonly version: number;
  readonly id: string;
  readonly timestamp: string;
  readonly cwd: string;
  readonly parentSession?: string;
}

export interface AgentMessageLike {
  readonly role: string;
  readonly content: unknown;
  readonly timestamp?: number;
}

interface SessionEntryBase {
  readonly id: string;
  readonly parentId: string | null;
  readonly timestamp: number;
}

export interface SessionMessageEntry extends SessionEntryBase {
  readonly type: "message";
  readonly message: AgentMessageLike;
}

export interface SessionModelChangeEntry extends SessionEntryBase {
  readonly type: "model_change";
  readonly provider: string;
  readonly modelId: string;
}

export interface SessionThinkingLevelChangeEntry extends SessionEntryBase {
  readonly type: "thinking_level_change";
  readonly thinkingLevel: string;
}

export interface SessionCompactionEntry extends SessionEntryBase {
  readonly type: "compaction";
  readonly summary: string;
  readonly firstKeptEntryId: string;
  readonly tokensBefore: number;
  readonly usage?: unknown;
  readonly details?: unknown;
  readonly fromHook?: boolean;
}

export interface SessionBranchSummaryEntry extends SessionEntryBase {
  readonly type: "branch_summary";
  readonly fromId: string | null;
  readonly summary: string;
  readonly usage?: unknown;
  readonly details?: unknown;
  readonly fromHook?: boolean;
}

export interface SessionCustomEntry extends SessionEntryBase {
  readonly type: "custom";
  readonly customType: string;
  readonly data?: unknown;
}

export interface SessionCustomMessageEntry extends SessionEntryBase {
  readonly type: "custom_message";
  readonly customType: string;
  readonly content: unknown;
  readonly display: boolean;
  readonly details?: unknown;
}

export interface SessionLabelEntry extends SessionEntryBase {
  readonly type: "label";
  readonly targetId: string;
  readonly label?: string;
}

export interface SessionInfoEntry extends SessionEntryBase {
  readonly type: "session_info";
  readonly name: string;
}

export type SessionEntry =
  | SessionMessageEntry
  | SessionModelChangeEntry
  | SessionThinkingLevelChangeEntry
  | SessionCompactionEntry
  | SessionBranchSummaryEntry
  | SessionCustomEntry
  | SessionCustomMessageEntry
  | SessionLabelEntry
  | SessionInfoEntry;

const KNOWN_ENTRY_TYPES = new Set<string>([
  "message",
  "model_change",
  "thinking_level_change",
  "compaction",
  "branch_summary",
  "custom",
  "custom_message",
  "label",
  "session_info",
]);

export interface OmoSessionOnDiskSummary {
  readonly durableId: string;
  readonly sessionPath: string;
  readonly forkedFrom: string | null;
  readonly title: string;
  readonly createdMs: number;
  readonly updatedMs: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSessionHeader(value: unknown): value is OmoSessionHeader {
  return (
    isRecord(value) &&
    value.type === "session" &&
    typeof value.id === "string" &&
    typeof value.timestamp === "string" &&
    typeof value.cwd === "string"
  );
}

function isSessionInfoEntry(value: unknown): value is SessionInfoEntry {
  return (
    isRecord(value) &&
    value.type === "session_info" &&
    typeof value.name === "string"
  );
}

function isUserMessageEntry(value: unknown): value is SessionMessageEntry & {
  readonly message: { readonly role: "user" };
} {
  return (
    isRecord(value) &&
    value.type === "message" &&
    isRecord(value.message) &&
    value.message.role === "user"
  );
}

function isSessionEntry(value: unknown): value is SessionEntry {
  return (
    isRecord(value) &&
    typeof value.type === "string" &&
    KNOWN_ENTRY_TYPES.has(value.type) &&
    typeof value.id === "string" &&
    (typeof value.parentId === "string" || value.parentId === null) &&
    (typeof value.timestamp === "string" ||
      typeof value.timestamp === "number")
  );
}

function isNodeErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

export function encodeCwdDir(cwd: string): string {
  const withoutLeadingSeparator = cwd.replace(/^[/\\]/, "");
  return withoutLeadingSeparator.replace(/[/\\:]/g, "-");
}

export function normalizeTimestampMs(value: string | number): number {
  if (typeof value === "number") {
    return value < EPOCH_SECONDS_HEURISTIC_THRESHOLD ? value * 1000 : value;
  }
  return Date.parse(value);
}

function normalizeSessionEntry(entry: SessionEntry): SessionEntry {
  const timestampValue: unknown = entry.timestamp;
  const timestamp =
    typeof timestampValue === "string" || typeof timestampValue === "number"
      ? normalizeTimestampMs(timestampValue)
      : Number.NaN;
  if (entry.type !== "message") return { ...entry, timestamp };

  const messageTimestampValue: unknown = entry.message.timestamp;
  if (
    typeof messageTimestampValue !== "string" &&
    typeof messageTimestampValue !== "number"
  ) {
    return { ...entry, timestamp };
  }
  return {
    ...entry,
    timestamp,
    message: {
      ...entry.message,
      timestamp: normalizeTimestampMs(messageTimestampValue),
    },
  };
}

async function readLeadingWindow(
  filePath: string,
  capBytes: number,
): Promise<string> {
  const handle = await open(filePath, "r");
  try {
    const buffer = Buffer.alloc(capBytes);
    const { bytesRead } = await handle.read(buffer, 0, capBytes, 0);
    return buffer.toString("utf8", 0, bytesRead);
  } finally {
    await handle.close();
  }
}

function extractFirstUserText(entry: SessionMessageEntry): string | null {
  const content = entry.message.content;
  let text: string;

  if (typeof content === "string") {
    text = content;
  } else if (Array.isArray(content)) {
    const textBlock = content.find(
      (block): block is { readonly type: string; readonly text: string } =>
        isRecord(block) &&
        block.type === "text" &&
        typeof block.text === "string",
    );
    if (!textBlock) return null;
    text = textBlock.text;
  } else {
    return null;
  }

  const trimmed = text.trim();
  if (!trimmed) return null;
  return trimmed.length > TITLE_MAX_CHARS
    ? trimmed.slice(0, TITLE_MAX_CHARS)
    : trimmed;
}

async function readSessionSummaryIfMatching(
  filePath: string,
  targetRealCwd: string,
): Promise<OmoSessionOnDiskSummary | null> {
  const window = await readLeadingWindow(filePath, HEADER_SCAN_CAP_BYTES);
  const lines = window.split("\n");
  const headerLine = lines[0];
  if (!headerLine) return null;

  let header: OmoSessionHeader;
  try {
    const parsed: unknown = JSON.parse(headerLine);
    if (!isSessionHeader(parsed)) return null;
    header = parsed;
  } catch {
    return null;
  }

  let headerRealCwd: string;
  try {
    headerRealCwd = await realpath(header.cwd);
  } catch {
    return null;
  }
  if (headerRealCwd !== targetRealCwd) return null;

  let sessionInfoName: string | null = null;
  let firstUserText: string | null = null;

  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line) continue;

    let parsedLine: unknown;
    try {
      parsedLine = JSON.parse(line);
    } catch {
      continue;
    }

    if (isSessionInfoEntry(parsedLine)) {
      sessionInfoName = parsedLine.name;
    } else if (firstUserText === null && isUserMessageEntry(parsedLine)) {
      firstUserText = extractFirstUserText(parsedLine);
    }
  }

  const stats = await stat(filePath);

  return {
    durableId: header.id,
    sessionPath: filePath,
    forkedFrom: header.parentSession ?? null,
    title: sessionInfoName ?? firstUserText ?? "Untitled",
    createdMs: normalizeTimestampMs(header.timestamp),
    updatedMs: stats.mtimeMs,
  };
}

export async function listOmoSessionsForCwd(options: {
  readonly agentDir: string;
  readonly cwd: string;
}): Promise<OmoSessionOnDiskSummary[]> {
  const { agentDir, cwd } = options;
  const dirPath = join(agentDir, "sessions", `--${encodeCwdDir(cwd)}--`);

  let dirEntries: Dirent[];
  try {
    dirEntries = await readdir(dirPath, { withFileTypes: true });
  } catch (error) {
    if (isNodeErrnoException(error) && error.code === "ENOENT") return [];
    throw error;
  }

  let targetRealCwd: string;
  try {
    targetRealCwd = await realpath(cwd);
  } catch {
    return [];
  }

  const summaries: OmoSessionOnDiskSummary[] = [];
  for (const entry of dirEntries) {
    if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
    const filePath = join(dirPath, entry.name);
    const summary = await readSessionSummaryIfMatching(filePath, targetRealCwd);
    if (summary) summaries.push(summary);
  }

  return summaries.sort((a, b) => b.updatedMs - a.updatedMs);
}

export async function readOmoSessionEntries(
  sessionPath: string,
): Promise<SessionEntry[]> {
  const entries: SessionEntry[] = [];
  const stream = createReadStream(sessionPath, {
    encoding: "utf8",
    end: ENTRIES_TOTAL_CAP_BYTES - 1,
  });
  const lineReader = createInterface({ input: stream, crlfDelay: Infinity });

  let isFirstLine = true;

  for await (const line of lineReader) {
    if (isFirstLine) {
      isFirstLine = false;
      continue;
    }
    if (!line.trim()) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      if (error instanceof SyntaxError) {
        console.warn(`Skipping malformed session entry line in ${sessionPath}`);
        continue;
      }
      throw error;
    }

    if (!isSessionEntry(parsed)) {
      console.warn(
        `Skipping unrecognized session entry line in ${sessionPath}`,
      );
      continue;
    }

    entries.push(normalizeSessionEntry(parsed));
  }

  return entries;
}

export function activeBranch(
  entries: readonly SessionEntry[],
  leafId: string,
): SessionEntry[] {
  const entriesById = new Map<string, SessionEntry>();
  for (const entry of entries) entriesById.set(entry.id, entry);

  const chain: SessionEntry[] = [];
  const visitedIds = new Set<string>();
  let currentId: string | null = leafId;

  while (currentId !== null) {
    if (visitedIds.has(currentId)) break;
    visitedIds.add(currentId);

    const entry = entriesById.get(currentId);
    if (!entry) break;

    chain.push(entry);
    currentId = entry.parentId;
  }

  return chain.reverse();
}

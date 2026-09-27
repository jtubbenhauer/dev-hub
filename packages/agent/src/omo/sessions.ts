import { createReadStream, type Dirent } from "node:fs";
import { open, readdir, realpath, rm, stat } from "node:fs/promises";
import { join, sep } from "node:path";
import { createInterface } from "node:readline";

const HEADER_SCAN_CAP_BYTES = 1_048_576;
const ENTRIES_TOTAL_CAP_BYTES = 67_108_864;
const TITLE_MAX_CHARS = 80;
const EPOCH_SECONDS_HEURISTIC_THRESHOLD = 1e12;

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

export type SessionEntry = Record<string, unknown> & {
  readonly type: string;
  readonly id: string;
  readonly parentId: string | null;
  readonly timestamp: string | number;
};

export type OmoSessionOnDiskSummary = {
  readonly durableId: string;
  readonly sessionPath: string;
  readonly forkedFrom: string | null;
  readonly title: string;
  readonly createdMs: number;
  readonly updatedMs: number;
};

type OmoSessionHeader = {
  readonly type: "session";
  readonly id: string;
  readonly timestamp: string;
  readonly cwd: string;
  readonly parentSession?: string;
};

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

function isSessionInfoEntry(
  value: unknown,
): value is { readonly type: "session_info"; readonly name: string } {
  return (
    isRecord(value) &&
    value.type === "session_info" &&
    typeof value.name === "string"
  );
}

function isUserMessageEntry(value: unknown): value is {
  readonly type: "message";
  readonly message: Record<string, unknown> & { readonly role: "user" };
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
    (typeof value.timestamp === "string" || typeof value.timestamp === "number")
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
  const timestamp = normalizeTimestampMs(entry.timestamp);
  if (entry.type !== "message") return { ...entry, timestamp };

  const message = entry.message;
  if (!isRecord(message)) return { ...entry, timestamp };
  const messageTimestampValue = message.timestamp;
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
      ...message,
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

function extractFirstUserText(entry: {
  readonly message: Record<string, unknown>;
}): string | null {
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

export async function listOmoSessionsForWorkspace(
  agentDir: string,
  workspacePath: string,
): Promise<OmoSessionOnDiskSummary[]> {
  const dirPath = join(
    agentDir,
    "sessions",
    `--${encodeCwdDir(workspacePath)}--`,
  );

  let dirEntries: Dirent[];
  try {
    dirEntries = await readdir(dirPath, { withFileTypes: true });
  } catch (error) {
    if (isNodeErrnoException(error) && error.code === "ENOENT") return [];
    throw error;
  }

  let targetRealCwd: string;
  try {
    targetRealCwd = await realpath(workspacePath);
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
      if (error instanceof SyntaxError) continue;
      throw error;
    }

    if (!isSessionEntry(parsed)) continue;

    entries.push(normalizeSessionEntry(parsed));
  }

  return entries;
}

export async function deleteOmoSession(
  agentDir: string,
  sessionPath: string,
): Promise<void> {
  const sessionsRoot = await realpath(join(agentDir, "sessions"));
  const realSessionPath = await realpath(sessionPath);
  if (
    realSessionPath !== sessionsRoot &&
    !realSessionPath.startsWith(sessionsRoot + sep)
  ) {
    throw new Error(
      "Refusing to delete a session outside the sessions directory",
    );
  }
  await rm(realSessionPath);
}

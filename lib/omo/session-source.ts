import { open, realpath, rm } from "node:fs/promises";
import { join, sep } from "node:path";
import {
  listOmoSessionsForCwd,
  readOmoSessionEntries,
  type OmoSessionHeader,
  type OmoSessionOnDiskSummary,
  type SessionEntry,
} from "@/lib/omo/sessions-on-disk";

const HEADER_SCAN_CAP_BYTES = 1_048_576;

export interface SessionSource {
  list(): Promise<readonly OmoSessionOnDiskSummary[]>;
  readEntries(rawId: string): Promise<readonly SessionEntry[]>;
  remove(rawId: string): Promise<void>;
  removeProbeSession(
    rawProbeId: string,
    sessionFile: string | undefined,
  ): Promise<void>;
  canonicalWorkspacePath(): Promise<string>;
  authorizeSession(rawId: string): Promise<boolean>;
}

export class OmoNotFoundError extends Error {
  readonly name = "OmoNotFoundError";

  constructor(readonly durableId: string) {
    super(`OmO session ${durableId} was not found`);
  }
}

type LocalFsSessionSourceOptions = {
  readonly agentDir: string;
  readonly workspacePath: string;
};

function isNodeErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function isSessionHeader(value: unknown): value is OmoSessionHeader {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    "type" in value &&
    value.type === "session" &&
    "id" in value &&
    typeof value.id === "string" &&
    "cwd" in value &&
    typeof value.cwd === "string" &&
    "timestamp" in value &&
    typeof value.timestamp === "string"
  );
}

async function readSessionHeader(
  sessionFile: string,
): Promise<OmoSessionHeader | null> {
  let handle;
  try {
    handle = await open(sessionFile, "r");
  } catch (error) {
    if (isNodeErrnoException(error) && error.code === "ENOENT") return null;
    throw error;
  }
  try {
    const buffer = Buffer.alloc(HEADER_SCAN_CAP_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const firstLine = buffer.toString("utf8", 0, bytesRead).split("\n", 1)[0];
    if (!firstLine) return null;
    try {
      const parsed: unknown = JSON.parse(firstLine);
      return isSessionHeader(parsed) ? parsed : null;
    } catch (error) {
      if (error instanceof SyntaxError) return null;
      throw error;
    }
  } finally {
    await handle.close();
  }
}

async function existingRealpath(filePath: string): Promise<string | null> {
  try {
    return await realpath(filePath);
  } catch (error) {
    if (isNodeErrnoException(error) && error.code === "ENOENT") return null;
    throw error;
  }
}

export class LocalFsSessionSource implements SessionSource {
  private readonly agentDir: string;
  private readonly workspacePath: string;

  constructor(options: LocalFsSessionSourceOptions) {
    this.agentDir = options.agentDir;
    this.workspacePath = options.workspacePath;
  }

  list(): Promise<readonly OmoSessionOnDiskSummary[]> {
    return listOmoSessionsForCwd({
      agentDir: this.agentDir,
      cwd: this.workspacePath,
    });
  }

  async readEntries(rawId: string): Promise<readonly SessionEntry[]> {
    const session = await this.findSession(rawId);
    if (session === undefined) throw new OmoNotFoundError(rawId);
    return readOmoSessionEntries(session.sessionPath);
  }

  async remove(rawId: string): Promise<void> {
    const session = await this.findSession(rawId);
    if (session === undefined) throw new OmoNotFoundError(rawId);
    await this.removeGuardedFile(rawId, session.sessionPath);
  }

  async removeProbeSession(
    rawProbeId: string,
    sessionFile: string | undefined,
  ): Promise<void> {
    if (sessionFile !== undefined) {
      await this.removeGuardedFile(rawProbeId, sessionFile);
      return;
    }
    const session = await this.findSession(rawProbeId);
    if (session !== undefined) {
      await this.removeGuardedFile(rawProbeId, session.sessionPath);
    }
  }

  canonicalWorkspacePath(): Promise<string> {
    return realpath(this.workspacePath);
  }

  async authorizeSession(rawId: string): Promise<boolean> {
    return (await this.findSession(rawId)) !== undefined;
  }

  private async findSession(
    rawId: string,
  ): Promise<OmoSessionOnDiskSummary | undefined> {
    const sessions = await this.list();
    return sessions.find((session) => session.durableId === rawId);
  }

  private async removeGuardedFile(
    rawId: string,
    sessionFile: string,
  ): Promise<void> {
    const targetPath = await existingRealpath(sessionFile);
    if (targetPath === null) return;
    const sessionsRoot = await realpath(join(this.agentDir, "sessions"));
    if (!targetPath.startsWith(`${sessionsRoot}${sep}`)) return;
    const header = await readSessionHeader(targetPath);
    if (header?.id !== rawId) return;
    const [headerWorkspacePath, workspacePath] = await Promise.all([
      existingRealpath(header.cwd),
      this.canonicalWorkspacePath(),
    ]);
    if (headerWorkspacePath !== workspacePath) return;
    await rm(targetPath, { force: true });
  }
}

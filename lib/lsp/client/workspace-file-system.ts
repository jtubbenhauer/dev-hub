import { Emitter } from "@codingame/monaco-vscode-api/vscode/vs/base/common/event";
import {
  Disposable,
  type IDisposable,
} from "@codingame/monaco-vscode-api/vscode/vs/base/common/lifecycle";
import type { URI } from "@codingame/monaco-vscode-api/vscode/vs/base/common/uri";
import {
  createFileSystemProviderError,
  FileSystemProviderCapabilities,
  FileSystemProviderErrorCode,
  FileType,
  type IFileChange,
  type IFileSystemProviderWithFileReadWriteCapability,
  type IStat,
} from "@codingame/monaco-vscode-api/vscode/vs/platform/files/common/files";
import { fileUriToWorkspaceRelativePath } from "@/lib/lsp/document-scope";

interface WorkspaceFileSystemOptions {
  readonly workspaceId: string;
  readonly workspaceRoot: string;
}

interface WorkspaceStatPayload {
  readonly type: "file" | "directory";
  readonly size: number;
  readonly mtime: number;
  readonly ctime: number;
  readonly content: string | null;
}

const FILE_TYPE_BY_STAT_TYPE = {
  file: FileType.File,
  directory: FileType.Directory,
} as const satisfies Record<WorkspaceStatPayload["type"], FileType>;

function parseStatPayload(data: unknown): WorkspaceStatPayload | null {
  if (typeof data !== "object" || data === null) return null;
  if (
    !("type" in data) ||
    (data.type !== "file" && data.type !== "directory") ||
    !("size" in data) ||
    typeof data.size !== "number" ||
    !("mtime" in data) ||
    typeof data.mtime !== "number" ||
    !("ctime" in data) ||
    typeof data.ctime !== "number"
  ) {
    return null;
  }
  const content =
    "content" in data && typeof data.content === "string" ? data.content : null;
  return {
    type: data.type,
    size: data.size,
    mtime: data.mtime,
    ctime: data.ctime,
    content,
  };
}

// The overlay retries FileNotFound/NoPermissions/Unavailable on its in-memory provider.
function notFoundError(resource: URI) {
  return createFileSystemProviderError(
    `Not a dev-hub workspace file: ${resource.toString(true)}`,
    FileSystemProviderErrorCode.FileNotFound,
  );
}

function unavailableError(message: string) {
  return createFileSystemProviderError(
    message,
    FileSystemProviderErrorCode.Unavailable,
  );
}

export function createWorkspaceFileSystemProvider({
  workspaceId,
  workspaceRoot,
}: WorkspaceFileSystemOptions): IFileSystemProviderWithFileReadWriteCapability {
  const normalizedRoot = workspaceRoot.replace(/\/+$/, "");

  // Phase 1's relative-path helper returns null for the root itself, so map it to "".
  function toWorkspaceRequestPath(resource: URI): string | null {
    if (resource.scheme !== "file") return null;
    if (resource.path.replace(/\/+$/, "") === normalizedRoot) return "";
    return fileUriToWorkspaceRelativePath(resource.toString(), normalizedRoot);
  }

  async function fetchWorkspaceStat(
    resource: URI,
    shouldIncludeContent: boolean,
  ): Promise<WorkspaceStatPayload> {
    const requestPath = toWorkspaceRequestPath(resource);
    if (requestPath === null) throw notFoundError(resource);
    const query = new URLSearchParams({ workspaceId, path: requestPath });
    if (shouldIncludeContent) query.set("content", "1");
    let response: Response;
    let data: unknown;
    try {
      response = await fetch(`/api/files/stat?${query.toString()}`);
      data = response.ok ? await response.json() : null;
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      throw unavailableError(error.message);
    }
    if (response.status === 404) throw notFoundError(resource);
    if (!response.ok) {
      throw unavailableError(`File stat failed with HTTP ${response.status}`);
    }
    const payload = parseStatPayload(data);
    if (payload === null)
      throw unavailableError("Malformed file stat response");
    return payload;
  }

  async function rejectWrite(...resources: readonly URI[]): Promise<never> {
    const isInsideWorkspace = resources.some(
      (resource) => toWorkspaceRequestPath(resource) !== null,
    );
    if (!isInsideWorkspace) throw notFoundError(resources[0]);
    // FileWriteLocked is not in the overlay's fall-through list, so writes never reach memory.
    throw createFileSystemProviderError(
      "read-only",
      FileSystemProviderErrorCode.FileWriteLocked,
    );
  }

  return {
    capabilities:
      FileSystemProviderCapabilities.FileReadWrite |
      FileSystemProviderCapabilities.PathCaseSensitive,
    onDidChangeCapabilities: new Emitter<void>().event,
    onDidChangeFile: new Emitter<readonly IFileChange[]>().event,
    watch(): IDisposable {
      return Disposable.None;
    },
    async stat(resource: URI): Promise<IStat> {
      const payload = await fetchWorkspaceStat(resource, false);
      return {
        type: FILE_TYPE_BY_STAT_TYPE[payload.type],
        size: payload.size,
        mtime: payload.mtime,
        ctime: payload.ctime,
      };
    },
    async readFile(resource: URI): Promise<Uint8Array> {
      const payload = await fetchWorkspaceStat(resource, true);
      if (payload.type === "directory") {
        throw createFileSystemProviderError(
          "Is a directory",
          FileSystemProviderErrorCode.FileIsADirectory,
        );
      }
      if (payload.content === null) {
        throw unavailableError("File stat response carried no content");
      }
      return new TextEncoder().encode(payload.content);
    },
    async readdir(resource: URI): Promise<[string, FileType][]> {
      if (toWorkspaceRequestPath(resource) === null) {
        throw notFoundError(resource);
      }
      return [];
    },
    writeFile: (resource: URI) => rejectWrite(resource),
    delete: (resource: URI) => rejectWrite(resource),
    mkdir: (resource: URI) => rejectWrite(resource),
    rename: (from: URI, to: URI) => rejectWrite(from, to),
  };
}

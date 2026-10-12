import type { LspWorkspaceEditResult } from "@/lib/lsp/types";

export type WriterFs = {
  readonly readFileSync: (path: string, encoding: "utf8") => string;
  readonly writeFileSync: (
    path: string,
    text: string,
    options: { encoding: "utf8"; flag: "wx" },
  ) => void;
  readonly renameSync: (from: string, to: string) => void;
  readonly unlinkSync: (path: string) => void;
  readonly existsSync: (path: string) => boolean;
  readonly realpathSync: (path: string) => string;
};
export type PreparedFile = {
  readonly path: string;
  readonly relativePath: string;
  readonly uri: string;
  readonly original: string | null;
  next: string;
};

export function commitWorkspaceEdit(
  files: readonly PreparedFile[],
  fs: WriterFs,
): LspWorkspaceEditResult {
  const committed: PreparedFile[] = [];
  const temporaryFiles = new Map<string, PreparedFile>();
  function writeAtomic(file: PreparedFile, text: string) {
    const temporary = `${file.path}.devhub-lsp-${process.pid}.tmp`;
    try {
      fs.writeFileSync(temporary, text, { encoding: "utf8", flag: "wx" });
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      if (!("code" in error && error.code === "EEXIST"))
        temporaryFiles.set(temporary, file);
      throw error;
    }
    temporaryFiles.set(temporary, file);
    fs.renameSync(temporary, file.path);
    temporaryFiles.delete(temporary);
  }
  try {
    for (const file of files) {
      writeAtomic(file, file.next);
      committed.push(file);
    }
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    const failed = new Map<string, PreparedFile>();
    for (const file of committed.reverse()) {
      try {
        if (file.original === null) fs.unlinkSync(file.path);
        else writeAtomic(file, file.original);
      } catch (rollbackError) {
        if (!(rollbackError instanceof Error)) throw rollbackError;
        failed.set(file.path, file);
      }
    }
    for (const [temporary, file] of temporaryFiles) {
      try {
        fs.unlinkSync(temporary);
      } catch (cleanupError) {
        if (!(cleanupError instanceof Error)) throw cleanupError;
        if (!("code" in cleanupError && cleanupError.code === "ENOENT"))
          failed.set(file.path, file);
      }
    }
    const failedFiles = [...failed.values()];
    const paths = failedFiles.map((file) => file.relativePath);
    if (paths.length > 0) console.error("[lsp] rollback failed", paths);
    return {
      applied: false,
      reason: `write failed: ${error.message}; ${paths.length === 0 ? "changes rolled back" : `rollback FAILED for ${paths.join(", ")} — check these files`}`,
      changedUris: failedFiles.map((file) => file.uri),
      createdUris: [],
    };
  }
  return {
    applied: true,
    reason: null,
    changedUris: files.map((file) => file.uri),
    createdUris: files
      .filter((file) => file.original === null)
      .map((file) => file.uri),
  };
}

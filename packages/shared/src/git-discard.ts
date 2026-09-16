// Shared, backend-agnostic helpers for the discard/revert operation.
// Imported by BOTH the Next.js app (lib/git/operations.ts) and the remote
// agent (packages/agent/src/routes/git.ts) so local + remote stay in parity
// by construction. NEVER copy this logic — import it.

// Rejects any path that is not workspace-relative: absolute POSIX (`/foo`),
// Windows drive (`C:whatever`), UNC (`\\server\share`), or any `..` segment
// after splitting on BOTH `/` and `\`. Mirrors the intent of the agent's
// readFileContentSafe path guard, but fails CLOSED by throwing.
export function assertWorkspaceRelativePaths(files: string[]): void {
  for (const file of files) {
    if (isOutsideWorkspacePath(file)) {
      throw new Error(`Invalid path outside workspace: ${file}`);
    }
  }
}

function isOutsideWorkspacePath(filePath: string): boolean {
  if (filePath.startsWith("/")) return true;
  if (/^[A-Za-z]:/.test(filePath)) return true;
  if (filePath.startsWith("\\")) return true;
  const segments = filePath.split(/[/\\]/);
  return segments.includes("..");
}

export interface DiscardBuckets {
  unstaged: string[];
  untracked: string[];
  conflicted: string[];
}

export interface DiscardPartition {
  tracked: string[];
  untracked: string[];
}

// Routes each requested file into `tracked` (restore via checkout) or
// `untracked` (delete via clean) using the FRESH server-side status buckets.
// - conflicted path -> THROW (fail-closed; the UI never offers these rows)
// - untracked-bucket path -> untracked
// - unstaged/tracked path -> tracked
// - path in no bucket (clean) -> skipped (idempotent no-op)
// When `expectedUntracked` is provided, requires set-equality with the
// computed untracked result and THROWS on mismatch (defends the confirm-dialog
// TOCTOU window). The server NEVER trusts it as classification — it only
// asserts against its own freshly computed partition.
export function partitionDiscardFiles(
  buckets: DiscardBuckets,
  files: string[],
  expectedUntracked?: string[],
): DiscardPartition {
  const untrackedSet = new Set(buckets.untracked);
  const conflictedSet = new Set(buckets.conflicted);
  const unstagedSet = new Set(buckets.unstaged);

  const tracked: string[] = [];
  const untracked: string[] = [];

  for (const file of files) {
    if (conflictedSet.has(file)) {
      throw new Error(`Cannot discard conflicted file: ${file}`);
    }
    if (untrackedSet.has(file)) {
      untracked.push(file);
    } else if (unstagedSet.has(file)) {
      tracked.push(file);
    }
    // else: clean file — nothing to discard, skip.
  }

  if (expectedUntracked !== undefined) {
    const computed = new Set(untracked);
    const expected = new Set(expectedUntracked);
    const isSameSet =
      computed.size === expected.size &&
      [...computed].every((path) => expected.has(path));
    if (!isSameSet) {
      throw new Error("File state changed - refresh and retry");
    }
  }

  return { tracked, untracked };
}

// Wraps each path as a literal git pathspec. `--` does NOT disable git
// pathspec magic and simple-git appends args verbatim, so a file literally
// named `*` would otherwise glob siblings.
export function toLiteralPathspecs(paths: string[]): string[] {
  return paths.map((path) => `:(literal)${path}`);
}

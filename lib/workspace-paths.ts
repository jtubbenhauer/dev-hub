/**
 * Converts an absolute file path to a repo-relative path by stripping the
 * workspace root prefix. Safe for client-side use — no Node.js APIs.
 *
 * Contract (applied in order):
 * 1. If filePath starts with workspaceRoot (normalized to one trailing slash),
 *    strip that prefix. Empty root skips this step.
 * 2. Strip a single leading "./" if present (normalizes already-relative inputs).
 * 3. An absolute path not under the root is returned unchanged — callers must
 *    treat a still-absolute result as "outside the repo".
 */
export function toRepoRelative(
  filePath: string,
  workspaceRoot: string,
): string {
  if (workspaceRoot) {
    const prefix = workspaceRoot.endsWith("/")
      ? workspaceRoot
      : workspaceRoot + "/";
    if (filePath.startsWith(prefix)) {
      filePath = filePath.slice(prefix.length);
    }
  }

  if (filePath.startsWith("./")) {
    filePath = filePath.slice(2);
  }

  return filePath;
}

/**
 * Builds the workspace-namespaced key used to persist a file's view mode
 * (editor vs diff). Namespacing by workspace keeps the same repo-relative path
 * independent across workspaces.
 */
export function fileViewKey(
  workspaceId: string,
  repoRelativePath: string,
): string {
  return `${workspaceId}:${repoRelativePath}`;
}

/**
 * True when a path is not safely inside the repo, so it must never be handed to
 * a git operation (diff, file-content). Covers POSIX-absolute paths, Windows
 * drive-letter absolutes, UNC paths, and any `..` traversal segment.
 */
export function isOutsideRepoPath(path: string): boolean {
  if (path.startsWith("/")) return true;
  if (/^[A-Za-z]:/.test(path)) return true;
  if (path.startsWith("\\\\")) return true;
  return path.split(/[/\\]/).includes("..");
}

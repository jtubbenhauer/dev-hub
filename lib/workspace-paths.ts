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

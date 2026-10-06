import { readdirSync, realpathSync } from "node:fs";
import {
  fileUriToAbsolutePath,
  workspaceRelativePathToFileUri,
} from "@/lib/lsp/document-scope";

type ResolverFileSystem = {
  readonly readdirSync: (directory: string) => string[];
  readonly realpathSync: (path: string) => string;
};

const MEMO_LIMIT = 5_000;

export function createCaseResolver(
  workspaceRoot: string,
  fsImpl: ResolverFileSystem = {
    readdirSync,
    realpathSync: realpathSync.native,
  },
) {
  const directories = new Map<string, string[]>();
  const resolvedPaths = new Map<string, string>();
  const rootPrefix = `${workspaceRoot.toLowerCase()}/`;
  const realRoot = resolvePath(workspaceRoot);

  function resolvePath(path: string): string | null {
    try {
      return fsImpl.realpathSync(path);
    } catch (error) {
      if (error instanceof Error) return null;
      throw error;
    }
  }

  function readDirectory(directory: string): string[] {
    const cached = directories.get(directory);
    if (cached) return cached;
    const entries = fsImpl.readdirSync(directory);
    if (directories.size >= MEMO_LIMIT) directories.clear();
    directories.set(directory, entries);
    return entries;
  }

  function matchSegment(directory: string, segment: string): string | null {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const entries = readDirectory(directory);
      const match = entries.includes(segment)
        ? segment
        : entries
            .filter((entry) => entry.toLowerCase() === segment.toLowerCase())
            .sort((left, right) => left.localeCompare(right))[0];
      if (match !== undefined) return match;
      directories.delete(directory);
    }
    return null;
  }

  function resolveRealCaseUri(uri: string): string | null {
    const absolutePath = fileUriToAbsolutePath(uri);
    if (
      realRoot === null ||
      !absolutePath?.toLowerCase().startsWith(rootPrefix)
    )
      return null;
    const relativePath = absolutePath.slice(rootPrefix.length);
    const segments = relativePath.split("/");
    if (segments.some((segment) => segment === ".." || segment === ""))
      return null;
    const key = relativePath.toLowerCase();
    let realRelative = resolvedPaths.get(key);
    if (realRelative === undefined) {
      const realSegments: string[] = [];
      let directory = workspaceRoot;
      try {
        for (const segment of segments) {
          const realSegment = matchSegment(directory, segment);
          if (realSegment === null) return null;
          realSegments.push(realSegment);
          directory += `/${realSegment}`;
        }
      } catch (error) {
        if (error instanceof Error) return null;
        throw error;
      }
      realRelative = realSegments.join("/");
    }
    const realPath = resolvePath(`${workspaceRoot}/${realRelative}`);
    if (!realPath?.startsWith(`${realRoot}/`)) return null;
    if (resolvedPaths.size >= MEMO_LIMIT) resolvedPaths.clear();
    resolvedPaths.set(key, realRelative);
    return workspaceRelativePathToFileUri(workspaceRoot, realRelative);
  }

  return { resolveRealCaseUri };
}

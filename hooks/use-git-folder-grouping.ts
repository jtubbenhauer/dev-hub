"use client";

import { useCallback, useEffect, useState } from "react";

const GROUP_BY_FOLDER_KEY = "dev-hub:git-group-by-folder";
const COLLAPSED_FOLDERS_KEY_PREFIX = "dev-hub:git-collapsed-folders:";

function collapsedFoldersKey(workspaceId: string): string {
  return `${COLLAPSED_FOLDERS_KEY_PREFIX}${workspaceId}`;
}

function readGroupByFolder(): boolean {
  try {
    const stored = localStorage.getItem(GROUP_BY_FOLDER_KEY);
    return stored !== null ? stored === "true" : true;
  } catch {
    return true;
  }
}

function readCollapsedFolders(workspaceId: string): Set<string> {
  try {
    const stored = localStorage.getItem(collapsedFoldersKey(workspaceId));
    if (!stored) return new Set();
    const parsed: unknown = JSON.parse(stored);
    if (
      Array.isArray(parsed) &&
      parsed.every((item) => typeof item === "string")
    ) {
      return new Set(parsed);
    }
    return new Set();
  } catch {
    return new Set();
  }
}

function persistCollapsedFolders(workspaceId: string, folders: Set<string>) {
  try {
    localStorage.setItem(
      collapsedFoldersKey(workspaceId),
      JSON.stringify([...folders]),
    );
  } catch {}
}

interface CollapsedState {
  workspaceId: string;
  collapsedFolders: Set<string>;
}

interface UseGitFolderGrouping {
  isGroupedByFolder: boolean;
  toggleGroupedByFolder: () => void;
  collapsedFolders: Set<string>;
  toggleFolder: (folderPath: string) => void;
}

export function useGitFolderGrouping(
  workspaceId: string,
): UseGitFolderGrouping {
  // Hydration-safe: initial state is the SSR-stable default. Persisted values
  // are loaded in mount effects below so server and first client markup match.
  const [isGroupedByFolder, setIsGroupedByFolder] = useState(true);
  const [collapsedState, setCollapsedState] = useState<CollapsedState>({
    workspaceId,
    collapsedFolders: new Set<string>(),
  });

  // Load the persisted grouping toggle after mount.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsGroupedByFolder(readGroupByFolder());
  }, []);

  // Load (and re-load on workspace switch) the persisted collapsed set. Held
  // together with its workspaceId so a stale set is never rendered or written.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCollapsedState({
      workspaceId,
      collapsedFolders: readCollapsedFolders(workspaceId),
    });
  }, [workspaceId]);

  const toggleGroupedByFolder = useCallback(() => {
    setIsGroupedByFolder((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(GROUP_BY_FOLDER_KEY, String(next));
      } catch {}
      return next;
    });
  }, []);

  const toggleFolder = useCallback(
    (folderPath: string) => {
      setCollapsedState((prev) => {
        // Mid workspace-switch the effect above may not have re-read yet; rebase
        // onto the current workspace's persisted set to avoid cross-writes.
        const base =
          prev.workspaceId === workspaceId
            ? prev.collapsedFolders
            : readCollapsedFolders(workspaceId);
        const next = new Set(base);
        if (next.has(folderPath)) {
          next.delete(folderPath);
        } else {
          next.add(folderPath);
        }
        persistCollapsedFolders(workspaceId, next);
        return { workspaceId, collapsedFolders: next };
      });
    },
    [workspaceId],
  );

  // During a workspace switch the reload effect runs after render, so the held
  // state may still reference the previous workspace — return an empty set until
  // it matches to avoid surfacing another workspace's collapsed folders.
  const collapsedFolders =
    collapsedState.workspaceId === workspaceId
      ? collapsedState.collapsedFolders
      : new Set<string>();

  return {
    isGroupedByFolder,
    toggleGroupedByFolder,
    collapsedFolders,
    toggleFolder,
  };
}

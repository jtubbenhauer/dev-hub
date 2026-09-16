"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";

import { useGitStatus } from "@/hooks/use-git";
import { useSidePanelStore } from "@/stores/side-panel-store";
import {
  fileViewKey,
  isOutsideRepoPath,
  toRepoRelative,
} from "@/lib/workspace-paths";
import type { GitStatusResult, OpenFile } from "@/types";

export type FileViewMode = "editor" | "diff";

// A repo-relative path is git-dirty when it appears in any change bucket, or
// when git collapsed a wholly-untracked directory into one "dir/" entry that is
// a prefix of the path.
export function isGitDirty(
  status: GitStatusResult | undefined,
  repoRelativePath: string,
): boolean {
  if (!status || !status.isRepo) return false;
  for (const f of status.staged) if (f.path === repoRelativePath) return true;
  for (const f of status.unstaged) if (f.path === repoRelativePath) return true;
  for (const p of status.untracked) if (p === repoRelativePath) return true;
  for (const p of status.conflicted) if (p === repoRelativePath) return true;
  for (const p of status.untracked) {
    if (p.endsWith("/") && repoRelativePath.startsWith(p)) return true;
  }
  return false;
}

interface FileViewModeResult {
  mode: FileViewMode | undefined;
  canDiff: boolean;
  repoRelativeKey: string;
  setMode: (mode: FileViewMode) => void;
}

// Owns the per-file editor/diff view mode for the chat side panel. The stored
// mode alone never renders diff — split-panel-files gates it behind canDiff.
export function useFileViewMode(
  workspaceId: string,
  workspacePath: string,
  activeFile: OpenFile | null,
): FileViewModeResult {
  const activeFilePath = activeFile?.path ?? null;
  const isActiveDirty = activeFile?.isDirty ?? false;

  const { data: status, dataUpdatedAt, refetch } = useGitStatus(workspaceId);

  const fileViewModes = useSidePanelStore((s) => s.fileViewModes);
  const openFiles = useSidePanelStore((s) => s.openFiles);

  const repoRelativeKey = useMemo(
    () => (activeFilePath ? toRepoRelative(activeFilePath, workspacePath) : ""),
    [activeFilePath, workspacePath],
  );
  const qualifiedKey = useMemo(
    () => (activeFilePath ? fileViewKey(workspaceId, repoRelativeKey) : ""),
    [activeFilePath, workspaceId, repoRelativeKey],
  );

  const canDiff =
    !!activeFilePath &&
    !isOutsideRepoPath(repoRelativeKey) &&
    status?.isRepo === true;

  // One-time initialization is tracked per qualified key; a re-run for an
  // already-initialized key returns early so mode never auto-flips.
  const initedKeys = useRef<Set<string>>(new Set());
  const activationTimes = useRef<Map<string, number>>(new Map());

  // Newest status kept in a ref (synced via effect, never during render) so the
  // async refetch failure path can re-check against the latest ambient data.
  const statusRef = useRef<GitStatusResult | undefined>(status);
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    if (!activeFilePath) return;
    const key = qualifiedKey;
    if (initedKeys.current.has(key)) return;

    const setMode = useSidePanelStore.getState().setFileViewMode;

    // Dirty priority: an unsaved in-memory buffer always opens in the editor,
    // and latches there even if git later reports the file dirty.
    if (isActiveDirty) {
      initedKeys.current.add(key);
      setMode(key, "editor");
      return;
    }

    // Outside-repo files can never diff; default editor without touching git.
    if (isOutsideRepoPath(repoRelativeKey)) {
      initedKeys.current.add(key);
      setMode(key, "editor");
      return;
    }

    let activationTime = activationTimes.current.get(key);
    if (activationTime === undefined) {
      activationTime = Date.now();
      activationTimes.current.set(key, activationTime);
    }

    // Fresh cache: decide synchronously from the status we already have.
    if (dataUpdatedAt >= activationTime) {
      initedKeys.current.add(key);
      setMode(key, isGitDirty(status, repoRelativeKey) ? "diff" : "editor");
      return;
    }

    // Stale cache: one awaited refetch per key, then decide from fresh data.
    initedKeys.current.add(key);
    let cancelled = false;
    refetch({ cancelRefetch: false })
      .then((result) => {
        if (cancelled) return;
        setMode(
          key,
          isGitDirty(result.data, repoRelativeKey) ? "diff" : "editor",
        );
      })
      .catch(() => {
        if (cancelled) return;
        // Fallback resolves to a concrete mode (never undefined). Unset the
        // activation stamp and re-check with the newest ambient data; a failed
        // status read is not trusted enough to auto-open diff.
        activationTimes.current.delete(key);
        const fallbackDirty =
          !isActiveDirty && isGitDirty(statusRef.current, repoRelativeKey);
        setMode(key, fallbackDirty ? "diff" : "editor");
      });
    return () => {
      cancelled = true;
    };
  }, [
    qualifiedKey,
    activeFilePath,
    isActiveDirty,
    repoRelativeKey,
    status,
    dataUpdatedAt,
    refetch,
  ]);

  // Prune stored modes for this workspace's files that are no longer open, so
  // closing a tab drops its qualified entry. Other workspaces are left intact.
  useEffect(() => {
    const prefix = `${workspaceId}:`;
    const valid = new Set(
      openFiles.map((f) =>
        fileViewKey(workspaceId, toRepoRelative(f.path, workspacePath)),
      ),
    );
    const current = useSidePanelStore.getState().fileViewModes;
    const stale = Object.keys(current).filter(
      (k) => k.startsWith(prefix) && !valid.has(k),
    );
    if (stale.length === 0) return;
    for (const k of stale) {
      initedKeys.current.delete(k);
      activationTimes.current.delete(k);
    }
    useSidePanelStore.setState((s) => {
      const next = { ...s.fileViewModes };
      for (const k of stale) delete next[k];
      return { fileViewModes: next };
    });
  }, [openFiles, workspaceId, workspacePath]);

  const setMode = useCallback(
    (mode: FileViewMode) => {
      if (!qualifiedKey) return;
      useSidePanelStore.getState().setFileViewMode(qualifiedKey, mode);
    },
    [qualifiedKey],
  );

  return {
    mode: qualifiedKey ? fileViewModes[qualifiedKey] : undefined,
    canDiff,
    repoRelativeKey,
    setMode,
  };
}

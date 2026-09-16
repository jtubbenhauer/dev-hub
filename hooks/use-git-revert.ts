"use client";

import { useCallback, useState } from "react";

import { useGitDiscard } from "@/hooks/use-git";
import type { RevertTarget } from "@/components/chat/git-revert-dialog";

// Owns the revert confirmation lifecycle for a single workspace: the pending
// target is captured at click time (including its workspaceId), cleared when
// the workspace changes, and the confirm handler FAILS CLOSED if the captured
// workspaceId no longer matches the active one — guarding against a status-poll
// race dispatching a discard against the wrong workspace.
export function useGitRevert(
  workspaceId: string,
  onDiscardSuccess: () => void,
) {
  const discardMutation = useGitDiscard(workspaceId);
  const [revertTarget, setRevertTarget] = useState<RevertTarget | null>(null);
  const [boundWorkspaceId, setBoundWorkspaceId] = useState(workspaceId);

  // Reset the pending target when the active workspace changes. Render-phase
  // adjustment is the lint-approved alternative to a setState-in-effect.
  if (workspaceId !== boundWorkspaceId) {
    setBoundWorkspaceId(workspaceId);
    setRevertTarget(null);
  }

  const requestRevert = useCallback((target: RevertTarget) => {
    setRevertTarget(target);
  }, []);

  const clearRevert = useCallback(() => setRevertTarget(null), []);

  const discardMutate = discardMutation.mutate;
  const confirmRevert = useCallback(
    (target: RevertTarget) => {
      if (target.workspaceId !== workspaceId) {
        setRevertTarget(null);
        return;
      }
      discardMutate(
        {
          action: "discard",
          files: [target.path],
          expectedUntracked: target.isUntracked ? [target.path] : [],
        },
        { onSuccess: onDiscardSuccess },
      );
      setRevertTarget(null);
    },
    [workspaceId, discardMutate, onDiscardSuccess],
  );

  return {
    revertTarget,
    isDiscarding: discardMutation.isPending,
    requestRevert,
    clearRevert,
    confirmRevert,
  };
}

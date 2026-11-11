"use client";

import { AddWorkspaceDialog } from "@/components/workspace/add-workspace-dialog";
import { CloneRepoDialog } from "@/components/workspace/clone-repo-dialog";
import { ConnectRemoteDialog } from "@/components/workspace/connect-remote-dialog";
import { CreateWorktreeDialog } from "@/components/workspace/create-worktree-dialog";

// The app-wide workspace dialogs, opened through useWorkspaceDialogStore.
export function WorkspaceDialogs() {
  return (
    <>
      <AddWorkspaceDialog />
      <CloneRepoDialog />
      <ConnectRemoteDialog />
      <CreateWorktreeDialog />
    </>
  );
}

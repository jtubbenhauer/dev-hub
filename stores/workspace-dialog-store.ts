import { create } from "zustand";

// The workspace dialogs the authenticated layout mounts once. Pages and the
// command palette open them here; at most one is open at a time.
export type WorkspaceDialog =
  | { readonly kind: "add-workspace" }
  | { readonly kind: "clone-repo" }
  | { readonly kind: "connect-remote" }
  // initialRepoId: the repo to start on; null starts on the repo list.
  | { readonly kind: "create-worktree"; readonly initialRepoId: string | null };

export type WorkspaceDialogKind = WorkspaceDialog["kind"];

interface WorkspaceDialogState {
  readonly openDialog: WorkspaceDialog | null;
  open: (dialog: WorkspaceDialog) => void;
  close: () => void;
}

export const useWorkspaceDialogStore = create<WorkspaceDialogState>()(
  (set) => ({
    openDialog: null,
    open: (dialog) => set({ openDialog: dialog }),
    close: () => set({ openDialog: null }),
  }),
);

export function useIsWorkspaceDialogOpen(kind: WorkspaceDialogKind): boolean {
  return useWorkspaceDialogStore((state) => state.openDialog?.kind === kind);
}

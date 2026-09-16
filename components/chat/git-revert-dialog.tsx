"use client";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { buttonVariants } from "@/components/ui/button";

export interface RevertTarget {
  workspaceId: string;
  path: string;
  isUntracked: boolean;
}

interface GitRevertDialogProps {
  target: RevertTarget | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: (target: RevertTarget) => void;
}

function basename(path: string): string {
  const segments = path.split("/");
  return segments[segments.length - 1] || path;
}

export function GitRevertDialog({
  target,
  onOpenChange,
  onConfirm,
}: GitRevertDialogProps) {
  const name = target ? basename(target.path) : "";
  const isUntracked = target?.isUntracked ?? false;

  const title = isUntracked ? `Delete ${name}?` : `Discard changes to ${name}?`;
  const body = isUntracked
    ? "This file is untracked - deleting it cannot be undone."
    : "This reverts the file to its last staged or committed state.";

  return (
    <AlertDialog open={target !== null} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{body}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="git-revert-cancel">
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            data-testid="git-revert-confirm"
            className={buttonVariants({ variant: "destructive" })}
            onClick={() => {
              if (target) onConfirm(target);
            }}
          >
            {isUntracked ? "Delete" : "Discard"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

"use client";

import { useCallback, useState } from "react";
import { FileCode2, GitCompare } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SidePanelDiffView } from "@/components/chat/side-panel-diff-view";
import { useChatSidebarTabsOpenSetting } from "@/hooks/use-settings";
import { useChatFileDialogStore } from "@/stores/chat-file-dialog-store";

interface GitDiffDialogTarget {
  path: string;
  staged: boolean;
}

export function useGitDiffDialog(workspaceId: string) {
  const { sidebarTabsOpenMode } = useChatSidebarTabsOpenSetting();
  const [target, setTarget] = useState<GitDiffDialogTarget | null>(null);
  const openDiffDialog = useCallback((path: string, staged: boolean) => {
    setTarget({ path, staged });
  }, []);
  const diffDialog = (
    <GitDiffDialog
      workspaceId={workspaceId}
      target={target}
      onClose={() => setTarget(null)}
    />
  );
  return {
    isDialogMode: sidebarTabsOpenMode === "dialog",
    openDiffDialog,
    diffDialog,
  };
}

function GitDiffDialog({
  workspaceId,
  target,
  onClose,
}: {
  workspaceId: string;
  target: GitDiffDialogTarget | null;
  onClose: () => void;
}) {
  const handleOpenFile = () => {
    if (!target) return;
    const path = target.path;
    onClose();
    void useChatFileDialogStore
      .getState()
      .openFile(workspaceId, path, () => toast.error(`Could not open ${path}`));
  };

  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="flex h-[85dvh] max-h-[85dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-6xl"
        data-testid="git-diff-dialog"
      >
        <DialogHeader className="flex shrink-0 flex-row items-center gap-2 border-b px-4 py-3 pr-12 text-left">
          <GitCompare className="text-muted-foreground size-4 shrink-0" />
          <DialogTitle
            className="min-w-0 flex-1 truncate text-sm"
            title={target?.path}
          >
            {target?.path}
          </DialogTitle>
          {target?.staged && (
            <span className="text-muted-foreground shrink-0 text-xs">
              Staged
            </span>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={handleOpenFile}
            aria-label="Open file"
            data-testid="git-diff-dialog-open-file"
            className="px-2 sm:px-3"
          >
            <FileCode2 className="size-3.5" />
            <span className="hidden sm:inline">Open file</span>
          </Button>
        </DialogHeader>
        <div className="min-h-0 flex-1">
          {target && (
            <SidePanelDiffView
              workspaceId={workspaceId}
              filePath={target.path}
              staged={target.staged}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

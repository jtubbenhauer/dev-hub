"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { ExternalLink, FileCode2, Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useChatFileDialogStore } from "@/stores/chat-file-dialog-store";
import { FileViewer } from "@/components/editor/file-viewer";
import { FileDownloadButton } from "@/components/editor/file-download-button";
import { MarkdownPreviewToggle } from "@/components/editor/markdown-preview";
import { CsvPreviewToggle } from "@/components/editor/csv-preview";
import { isTextEditorLanguage } from "@/lib/file-preview";
import { useLspEnabledSetting } from "@/hooks/use-settings";
import {
  buildFileSaveBody,
  resolveTabWorkspaceId,
} from "@/lib/files/save-request";
import { completeFileSave } from "@/lib/files/save-completion";
import { submitFileSave } from "@/lib/files/submit-file-save";

export function ChatFileDialog() {
  const isOpen = useChatFileDialogStore((state) => state.isOpen);
  const isLoading = useChatFileDialogStore((state) => state.isLoading);
  const file = useChatFileDialogStore((state) => state.file);
  const originalContent = useChatFileDialogStore(
    (state) => state.originalContent,
  );
  const setContent = useChatFileDialogStore((state) => state.setContent);
  const { isLspEnabled } = useLspEnabledSetting();
  const reset = useChatFileDialogStore((state) => state.reset);
  const [isSaving, setIsSaving] = useState(false);
  const queryClient = useQueryClient();

  const isDirty = file !== null && file.content !== originalContent;
  const isTextFile = file !== null && isTextEditorLanguage(file.language);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen && isDirty) {
        const shouldDiscard = window.confirm(
          "You have unsaved changes. Close and discard them?",
        );
        if (!shouldDiscard) return;
      }
      if (!nextOpen) reset();
    },
    [isDirty, reset],
  );

  const handleSave = useCallback(async () => {
    if (!file || !isDirty || isSaving) return;
    setIsSaving(true);
    const snapshot = {
      workspaceId: resolveTabWorkspaceId(file, file.workspaceId),
      path: file.path,
      instanceId: file.instanceId,
      submittedBase: originalContent,
      savedContent: file.content,
    };
    try {
      await submitFileSave(
        buildFileSaveBody({
          workspaceId: snapshot.workspaceId,
          path: snapshot.path,
          content: snapshot.savedContent,
          originalContent: snapshot.submittedBase,
          isLspEnabled,
        }),
      );
      completeFileSave({
        snapshotWorkspaceId: snapshot.workspaceId,
        getBoundWorkspaceId: () =>
          useChatFileDialogStore.getState().file?.workspaceId,
        acknowledge: () =>
          useChatFileDialogStore.getState().markSavedAs(snapshot),
        runFollowUps: () => {
          void queryClient.invalidateQueries({
            queryKey: ["git-status", snapshot.workspaceId],
          });
          toast.success("File saved");
        },
      });
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      toast.error(error.message);
    } finally {
      setIsSaving(false);
    }
  }, [file, originalContent, isDirty, isSaving, isLspEnabled, queryClient]);

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="flex h-[85dvh] max-h-[85dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-6xl">
        <DialogHeader className="flex shrink-0 flex-row items-center gap-2 border-b px-4 py-3 pr-12 text-left">
          <FileCode2 className="text-muted-foreground size-4 shrink-0" />
          <DialogTitle
            className="min-w-0 flex-1 truncate text-sm"
            title={file?.path}
          >
            {file?.path ?? "Opening file"}
          </DialogTitle>
          {isDirty && (
            <span className="text-muted-foreground shrink-0 text-xs">
              Modified
            </span>
          )}
          {file && (
            <Button variant="ghost" size="sm" asChild>
              <Link
                href={`/files?open=${encodeURIComponent(file.path)}`}
                title="Open in full editor"
                aria-label="Open in full editor"
                className="px-2 sm:px-3"
              >
                <ExternalLink className="size-3.5" />
                <span className="hidden sm:inline">Full editor</span>
              </Link>
            </Button>
          )}
          {file && isTextFile && (
            <MarkdownPreviewToggle
              language={file.language}
              filePath={file.path}
              size="sm"
              className="size-8 p-0"
            />
          )}
          {file && isTextFile && (
            <CsvPreviewToggle
              filePath={file.path}
              size="sm"
              className="size-8 p-0"
            />
          )}
          {isTextFile && (
            <Button
              size="sm"
              onClick={handleSave}
              disabled={!isDirty || isSaving}
              aria-label="Save file"
              className="px-2 sm:px-3"
            >
              {isSaving ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Save className="size-3.5" />
              )}
              <span className="hidden sm:inline">Save</span>
            </Button>
          )}
          {file && (
            <FileDownloadButton
              workspaceId={file.workspaceId}
              filePath={file.path}
              language={file.language}
              content={file.content}
              className="size-8 p-0"
            />
          )}
        </DialogHeader>

        <div className="min-h-0 flex-1">
          {isLoading || !file ? (
            <div className="text-muted-foreground flex h-full items-center justify-center gap-2 text-sm">
              <Loader2 className="size-4 animate-spin" />
              Opening file...
            </div>
          ) : (
            <FileViewer
              workspaceId={file.workspaceId}
              filePath={file.path}
              content={file.content}
              language={file.language}
              onChange={setContent}
              onSave={handleSave}
              autoFocus
              isLspEligible
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

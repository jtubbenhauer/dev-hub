"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { ExternalLink, FileCode2, Loader2, Save } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EditorSwitcher } from "@/components/editor/editor-switcher";
import { useChatFileDialogStore } from "@/stores/chat-file-dialog-store";

export function ChatFileDialog() {
  const isOpen = useChatFileDialogStore((state) => state.isOpen);
  const isLoading = useChatFileDialogStore((state) => state.isLoading);
  const file = useChatFileDialogStore((state) => state.file);
  const originalContent = useChatFileDialogStore(
    (state) => state.originalContent,
  );
  const setContent = useChatFileDialogStore((state) => state.setContent);
  const markSaved = useChatFileDialogStore((state) => state.markSaved);
  const reset = useChatFileDialogStore((state) => state.reset);
  const [isSaving, setIsSaving] = useState(false);

  const isDirty = file !== null && file.content !== originalContent;

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
    try {
      const response = await fetch("/api/files/content", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: file.workspaceId,
          path: file.path,
          content: file.content,
        }),
      });
      if (!response.ok) {
        toast.error("Failed to save file");
        return;
      }
      markSaved();
      toast.success("File saved");
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      toast.error("Failed to save file");
    } finally {
      setIsSaving(false);
    }
  }, [file, isDirty, isSaving, markSaved]);

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
        </DialogHeader>

        <div className="min-h-0 flex-1">
          {isLoading || !file ? (
            <div className="text-muted-foreground flex h-full items-center justify-center gap-2 text-sm">
              <Loader2 className="size-4 animate-spin" />
              Opening file...
            </div>
          ) : (
            <EditorSwitcher
              content={file.content}
              language={file.language}
              onChange={setContent}
              onSave={handleSave}
              filePath={file.path}
              workspaceId={file.workspaceId}
              autoFocus
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

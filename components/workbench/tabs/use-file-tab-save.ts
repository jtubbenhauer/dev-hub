import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useLintOnSave } from "@/hooks/use-diagnostics";
import { useLspEnabledSetting } from "@/hooks/use-settings";
import { isTextEditorLanguage } from "@/lib/file-preview";
import { findOwnFileBuffer } from "@/lib/files/own-file-buffer";
import { completeFileSave } from "@/lib/files/save-completion";
import { buildFileSaveBody } from "@/lib/files/save-request";
import { submitFileSave } from "@/lib/files/submit-file-save";
import { useEditorStore } from "@/stores/editor-store";
import { useWorkspaceStore } from "@/stores/workspace-store";

export interface FileTabSave {
  readonly save: () => Promise<void>;
  readonly isSaving: boolean;
}

// Saves the tab's own buffer, whatever file the editor store calls active.
export function useFileTabSave(workspaceId: string, path: string): FileTabSave {
  const { isLspEnabled } = useLspEnabledSetting();
  const { lintFile } = useLintOnSave(workspaceId, path);
  const queryClient = useQueryClient();
  const [isSaving, setIsSaving] = useState(false);

  const save = useCallback(async () => {
    const buffer = findOwnFileBuffer(
      useEditorStore.getState().openFiles,
      workspaceId,
      path,
    );
    if (!buffer) return;
    // Preview tabs hold no text content, so saving would truncate the file.
    if (!isTextEditorLanguage(buffer.language)) return;

    setIsSaving(true);
    const snapshot = {
      workspaceId,
      path: buffer.path,
      instanceId: buffer.instanceId,
      submittedBase: buffer.originalContent,
      savedContent: buffer.content,
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
          useWorkspaceStore.getState().activeWorkspaceId,
        acknowledge: () => useEditorStore.getState().markFileSavedAs(snapshot),
        runFollowUps: () => {
          void lintFile();
          void queryClient.invalidateQueries({
            queryKey: ["git-status", snapshot.workspaceId],
          });
          toast.success("Saved");
        },
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Save failed");
    } finally {
      setIsSaving(false);
    }
  }, [workspaceId, path, isLspEnabled, lintFile, queryClient]);

  return { save, isSaving };
}

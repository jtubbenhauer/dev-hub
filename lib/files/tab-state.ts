import type { OpenFile } from "@/types";

export type OpenFileResult =
  | "opened"
  | "activated"
  | "replaced-foreign"
  | "kept-foreign-dirty";
export type SaveAcknowledgment = "acknowledged" | "ignored";
export type DiskReplacement = "replaced" | "dirty-skipped" | "not-open";
export type FileSaveSnapshot = {
  readonly path: string;
  readonly instanceId: number | undefined;
  readonly submittedBase: string;
  readonly savedContent: string;
};

export function getFileOpenResult(
  existing: OpenFile | undefined,
  workspaceId: string | undefined,
): OpenFileResult {
  if (!existing) return "opened";
  if (
    existing.workspaceId === undefined ||
    workspaceId === undefined ||
    existing.workspaceId === workspaceId
  )
    return "activated";
  return existing.isDirty ? "kept-foreign-dirty" : "replaced-foreign";
}

export function createFileContentActions(
  get: () => { openFiles: OpenFile[] },
  set: (state: { openFiles: OpenFile[] }) => void,
) {
  return {
    replaceFileContentFromDisk(
      workspaceId: string,
      path: string,
      content: string,
    ): DiskReplacement {
      const { openFiles } = get();
      const file = openFiles.find(
        (tab) => tab.path === path && tab.workspaceId === workspaceId,
      );
      if (!file) return "not-open";
      if (file.isDirty) return "dirty-skipped";
      set({
        openFiles: openFiles.map((tab) =>
          tab === file
            ? { ...tab, content, originalContent: content, isDirty: false }
            : tab,
        ),
      });
      return "replaced";
    },
    markFileSavedAs(input: FileSaveSnapshot): SaveAcknowledgment {
      const { openFiles } = get();
      const file = openFiles.find((tab) => tab.path === input.path);
      if (
        !file ||
        file.instanceId !== input.instanceId ||
        file.originalContent !== input.submittedBase
      )
        return "ignored";
      set({
        openFiles: openFiles.map((tab) =>
          tab === file
            ? {
                ...tab,
                originalContent: input.savedContent,
                isDirty: tab.content !== input.savedContent,
              }
            : tab,
        ),
      });
      return "acknowledged";
    },
  };
}

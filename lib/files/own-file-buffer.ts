import { resolveTabWorkspaceId } from "@/lib/files/save-request";
import type { OpenFile } from "@/types";

// A buffer without a workspace (opened before buffers were tagged) is adopted.
export function findOwnFileBuffer(
  openFiles: readonly OpenFile[],
  workspaceId: string,
  path: string,
): OpenFile | undefined {
  return openFiles.find(
    (file) =>
      file.path === path &&
      resolveTabWorkspaceId(file, workspaceId) === workspaceId,
  );
}

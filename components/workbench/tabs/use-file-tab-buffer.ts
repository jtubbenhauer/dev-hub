import { useEffect, useState } from "react";
import { loadFileIntoEditorBuffer } from "@/lib/files/load-file-into-editor-buffer";
import { findOwnFileBuffer } from "@/lib/files/own-file-buffer";
import { resolveTabWorkspaceId } from "@/lib/files/save-request";
import { useEditorStore } from "@/stores/editor-store";

export type FileTabBuffer =
  | { readonly status: "ready"; readonly language: string }
  | { readonly status: "loading" }
  | { readonly status: "not-found" }
  | { readonly status: "held-dirty-elsewhere" };

// A restored tab outlives its buffer (page reload, workspace switch), so it
// loads its file again, but never over another workspace's unsaved edits.
export function useFileTabBuffer(
  workspaceId: string,
  path: string,
): FileTabBuffer {
  const language = useEditorStore(
    (state) =>
      findOwnFileBuffer(state.openFiles, workspaceId, path)?.language ?? null,
  );
  const isHeldDirtyElsewhere = useEditorStore((state) =>
    state.openFiles.some(
      (file) =>
        file.path === path &&
        file.isDirty &&
        resolveTabWorkspaceId(file, workspaceId) !== workspaceId,
    ),
  );
  const [missingFileKey, setMissingFileKey] = useState<string | null>(null);
  const fileKey = `${workspaceId}:${path}`;
  const shouldLoad = language === null && !isHeldDirtyElsewhere;

  useEffect(() => {
    if (!shouldLoad) return;
    let isMounted = true;
    void loadFileIntoEditorBuffer({
      workspaceId,
      path,
      isFileTabsDisabled: false,
      shouldCommit: () => isMounted,
    }).then((isLoaded) => {
      if (isMounted && !isLoaded) setMissingFileKey(`${workspaceId}:${path}`);
    });
    return () => {
      isMounted = false;
    };
  }, [shouldLoad, workspaceId, path]);

  if (language !== null) return { status: "ready", language };
  if (isHeldDirtyElsewhere) return { status: "held-dirty-elsewhere" };
  return missingFileKey === fileKey
    ? { status: "not-found" }
    : { status: "loading" };
}

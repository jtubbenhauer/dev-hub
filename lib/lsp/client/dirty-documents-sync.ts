import { workspaceRelativePathToFileUri } from "@/lib/lsp/document-scope";
import { useChatFileDialogStore } from "@/stores/chat-file-dialog-store";
import { useEditorStore } from "@/stores/editor-store";
import { useSidePanelStore } from "@/stores/side-panel-store";

export function startDirtyDocumentsSync(options: {
  readonly workspaceId: string;
  readonly workspaceRoot: string;
  readonly send: (uris: string[]) => void;
}): { dispose(): void } {
  let previousKey: string | undefined;
  function sync() {
    const uris = new Set<string>();
    for (const store of [useEditorStore, useSidePanelStore]) {
      for (const file of store.getState().openFiles) {
        if (
          file.isDirty &&
          (file.workspaceId === undefined ||
            file.workspaceId === options.workspaceId)
        ) {
          uris.add(
            workspaceRelativePathToFileUri(options.workspaceRoot, file.path),
          );
        }
      }
    }
    const { file, originalContent } = useChatFileDialogStore.getState();
    if (
      file?.workspaceId === options.workspaceId &&
      file.content !== originalContent
    ) {
      uris.add(
        workspaceRelativePathToFileUri(options.workspaceRoot, file.path),
      );
    }
    const sortedUris = [...uris].sort();
    const key = sortedUris.join("\n");
    if (key === previousKey) return;
    previousKey = key;
    options.send(sortedUris);
  }
  const unsubscribe = [
    useEditorStore.subscribe(sync),
    useSidePanelStore.subscribe(sync),
    useChatFileDialogStore.subscribe(sync),
  ];
  sync();
  return {
    dispose() {
      for (const stop of unsubscribe) stop();
    },
  };
}

import { toast } from "sonner";
import {
  fileUriToWorkspaceRelativePath,
  toLowerCaseUriKey,
} from "@/lib/lsp/document-scope";
import type { LspWorkspaceEditResult } from "@/lib/lsp/types";
import { requestGitStatusRefresh } from "@/lib/git/git-status-refresh";
import { useChatFileDialogStore } from "@/stores/chat-file-dialog-store";
import { useEditorStore } from "@/stores/editor-store";
import { useSidePanelStore } from "@/stores/side-panel-store";

const reloadGeneration = new Map<string, number>();
let nextReloadGeneration = 0;

export async function handleWorkspaceEditResult(
  result: LspWorkspaceEditResult,
  context: {
    readonly monaco: typeof import("monaco-editor");
    readonly workspaceId: string;
    readonly workspaceRoot: string;
  },
): Promise<void> {
  if (!result.applied) toast.error("Edit not applied: " + result.reason);
  // A refused edit can still leave files changed on disk when its rollback fails.
  if (result.applied || result.changedUris.length > 0)
    requestGitStatusRefresh(context.workspaceId);
  const reloads = result.changedUris.flatMap((uri) => {
    const relativePath = fileUriToWorkspaceRelativePath(
      uri,
      context.workspaceRoot,
    );
    if (relativePath === null) return [];
    const key = toLowerCaseUriKey(uri);
    const generation = ++nextReloadGeneration;
    reloadGeneration.set(key, generation);
    const models = context.monaco.editor
      .getModels()
      .filter((model) => toLowerCaseUriKey(model.uri.toString()) === key)
      .map((model) => ({ model, versionAtArrival: model.getVersionId() }));
    return [{ relativePath, key, generation, models }];
  });
  await Promise.all(
    reloads.map(async ({ relativePath, key, generation, models }) => {
      try {
        let data: unknown;
        try {
          const response = await fetch(
            `/api/files/content?workspaceId=${encodeURIComponent(context.workspaceId)}&path=${encodeURIComponent(relativePath)}`,
          );
          if (!response.ok) return;
          data = await response.json();
        } catch (error) {
          if (!(error instanceof Error)) throw error;
          return;
        }
        if (reloadGeneration.get(key) !== generation) return;
        if (
          typeof data !== "object" ||
          data === null ||
          !("content" in data) ||
          typeof data.content !== "string"
        )
          return;
        const content = data.content;
        const replacements = [
          useEditorStore
            .getState()
            .replaceFileContentFromDisk(
              context.workspaceId,
              relativePath,
              content,
            ),
          useSidePanelStore
            .getState()
            .replaceFileContentFromDisk(
              context.workspaceId,
              relativePath,
              content,
            ),
          useChatFileDialogStore
            .getState()
            .replaceContentFromDisk(context.workspaceId, relativePath, content),
        ];
        const warning = `${relativePath} changed on disk; your unsaved copy was kept`;
        if (replacements.includes("dirty-skipped")) {
          toast.warning(warning);
          return;
        }
        let hasChangedModel = false;
        for (const { model, versionAtArrival } of models) {
          if (model.isDisposed()) continue;
          if (model.getVersionId() !== versionAtArrival) {
            hasChangedModel = true;
            continue;
          }
          if (model.getValue() !== content) {
            model.pushEditOperations(
              [],
              [{ range: model.getFullModelRange(), text: content }],
              () => null,
            );
          }
        }
        if (hasChangedModel) toast.warning(warning);
      } finally {
        // Unique generations let completed entries be removed without reviving older fetches.
        if (reloadGeneration.get(key) === generation)
          reloadGeneration.delete(key);
      }
    }),
  );
}

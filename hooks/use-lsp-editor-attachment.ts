import { useEffect, useId, useRef, type RefObject } from "react";
import type { editor } from "monaco-editor";
import { useLspEnabledSetting } from "@/hooks/use-settings";
import { registerLspMonacoInstance } from "@/lib/lsp/client/lsp-session";
import { takePendingNavigation } from "@/lib/lsp/client/navigation-registry";
import {
  isLspDocumentPath,
  toLowerCaseUriKey,
  workspaceRelativePathToFileUri,
} from "@/lib/lsp/document-scope";
import { useLspStore } from "@/stores/lsp-store";
import { useWorkspaceStore } from "@/stores/workspace-store";

// Monaco's debounced word highlighter and async providers keep running on the old model after a switch.
export const PREVIOUS_MODEL_DISPOSE_DELAY_MS = 5_000;
const pendingPreviousModelDisposals = new WeakMap<
  editor.ITextModel,
  ReturnType<typeof setTimeout>
>();

export function useLspEditorAttachment({
  editorRef,
  monacoRef,
  isEditorReady,
  workspaceId,
  filePath,
  isLspEligible,
  content,
}: {
  readonly editorRef: RefObject<editor.IStandaloneCodeEditor | null>;
  readonly monacoRef: RefObject<typeof import("monaco-editor") | null>;
  readonly isEditorReady: boolean;
  readonly workspaceId: string | undefined;
  readonly filePath: string | undefined;
  readonly isLspEligible: boolean | undefined;
  readonly content: string;
}): string | undefined {
  const { isLspEnabled } = useLspEnabledSetting();
  const activeWorkspaceId = useWorkspaceStore(
    (state) => state.activeWorkspaceId,
  );
  const workspace = useWorkspaceStore(
    (state) =>
      state.workspaces.find((entry) => entry.id === workspaceId) ?? null,
  );
  const candidateUri =
    isLspEligible &&
    isLspEnabled &&
    workspace &&
    workspace.backend === "local" &&
    workspaceId === activeWorkspaceId &&
    filePath &&
    isLspDocumentPath(filePath)
      ? workspaceRelativePathToFileUri(workspace.path, filePath)
      : undefined;
  const ownerId = useId();
  const uriKey = candidateUri ? toLowerCaseUriKey(candidateUri) : undefined;
  const currentOwner = useLspStore((state) =>
    uriKey ? state.documentOwners[uriKey] : undefined,
  );
  const modelPath = currentOwner === ownerId ? candidateUri : undefined;

  useEffect(() => {
    if (uriKey === undefined) return;
    useLspStore.getState().claimDocument(uriKey, ownerId);
    return () => useLspStore.getState().releaseDocument(uriKey, ownerId);
  }, [uriKey, ownerId]);

  useEffect(() => {
    if (uriKey !== undefined && currentOwner === undefined) {
      useLspStore.getState().claimDocument(uriKey, ownerId);
    }
  }, [uriKey, ownerId, currentOwner]);

  useEffect(() => {
    if (isEditorReady && candidateUri && monacoRef.current) {
      registerLspMonacoInstance(monacoRef.current);
    }
  }, [isEditorReady, candidateUri, monacoRef]);

  useEffect(() => {
    if (!isEditorReady) return;
    editorRef.current?.updateOptions({
      "semanticHighlighting.enabled": modelPath ? true : "configuredByTheme",
    });
  }, [isEditorReady, modelPath, editorRef]);

  const contentRef = useRef(content);
  useEffect(() => {
    contentRef.current = content;
  }, [content]);

  useEffect(() => {
    const editorInstance = editorRef.current;
    if (!isEditorReady || !editorInstance) return;
    // Parent passive effects run after Monaco's child setModel/restoreViewState.
    const model = editorInstance.getModel();
    if (
      modelPath &&
      model?.uri.scheme === "file" &&
      model.getValue() !== contentRef.current
    ) {
      model.setValue(contentRef.current);
    }
    const applyPending = () => {
      const currentModel = editorInstance.getModel();
      const surface = editorInstance
        .getContainerDomNode()
        .closest("[data-lsp-surface]")
        ?.getAttribute("data-lsp-surface");
      if (!currentModel || !surface) return;
      const position = takePendingNavigation(
        surface,
        toLowerCaseUriKey(currentModel.uri.toString()),
      );
      if (position) {
        editorInstance.setPosition(position);
        editorInstance.revealPositionInCenter(position);
        editorInstance.focus();
      }
    };
    applyPending();
  }, [isEditorReady, modelPath, editorRef]);

  useEffect(() => {
    const editorInstance = editorRef.current;
    const monaco = monacoRef.current;
    if (!isEditorReady || !editorInstance || !monaco) return;
    const subscription = editorInstance.onDidChangeModel((event) => {
      const previous = event.oldModelUrl
        ? monaco.editor.getModel(event.oldModelUrl)
        : null;
      if (
        previous &&
        (previous.uri.scheme === "file" || event.newModelUrl?.scheme === "file")
      ) {
        clearTimeout(pendingPreviousModelDisposals.get(previous));
        const timer = setTimeout(() => {
          pendingPreviousModelDisposals.delete(previous);
          if (
            !previous.isDisposed() &&
            monaco.editor.getModel(previous.uri) === previous &&
            !previous.isAttachedToEditor() &&
            !monaco.editor
              .getEditors()
              .some((instance) => instance.getModel() === previous)
          )
            previous.dispose();
        }, PREVIOUS_MODEL_DISPOSE_DELAY_MS);
        pendingPreviousModelDisposals.set(previous, timer);
      }
    });
    // Pending timers outlive unmount so unshown models still close; the re-checks make late runs safe.
    return () => subscription.dispose();
  }, [isEditorReady, editorRef, monacoRef]);

  return modelPath;
}

import { useCallback, useEffect, useRef, type RefObject } from "react";
import type { DockviewPanelApi } from "dockview-react";
import type { EditorHandle } from "@/components/editor/editor-switcher";
import { FileViewer } from "@/components/editor/file-viewer";
import { FilesActiveEditor } from "@/components/editor/files-active-editor";
import { ProblemsPanel } from "@/components/editor/problems-panel";
import { Button } from "@/components/ui/button";
import { FileTabToolbar } from "@/components/workbench/tabs/file-tab-toolbar";
import { useFileTabSave } from "@/components/workbench/tabs/use-file-tab-save";
import {
  useFileTabViewMode,
  type FileTabViewMode,
} from "@/components/workbench/tabs/use-file-tab-view-mode";
import { WorkbenchDiffView } from "@/components/workbench/workbench-diff-view";
import { useEditorTypeSetting } from "@/hooks/use-settings";
import { isTextEditorLanguage } from "@/lib/file-preview";
import {
  clearFocusedFileTabCommands,
  setFocusedFileTabCommands,
} from "@/lib/workbench/focused-file-tab-commands";
import { useEditorStore } from "@/stores/editor-store";
import { useWorkbenchStore } from "@/stores/workbench-store";
import { useWorkspaceStore } from "@/stores/workspace-store";

export interface FileTabEditorProps {
  readonly api: DockviewPanelApi;
  readonly workspaceId: string;
  readonly path: string;
  readonly language: string;
  readonly isFocused: boolean;
  readonly isVisible: boolean;
}

interface FileTabTextBodyProps extends FileTabEditorProps {
  readonly editorHandleRef: RefObject<EditorHandle | null>;
  readonly onChange: (content: string) => void;
  readonly onSave: () => void;
}

type FileTabBodyKind = "preview" | "diff" | "text";

function bodyKindOf(
  language: string,
  viewMode: FileTabViewMode,
): FileTabBodyKind {
  if (!isTextEditorLanguage(language)) return "preview";
  return viewMode.isDiffShown ? "diff" : "text";
}

// The pty server runs a single Neovim, so only the last focused visible file
// tab mounts it; every other file tab offers to take it over.
function FileTabTextBody({
  api,
  workspaceId,
  path,
  language,
  isFocused,
  isVisible,
  editorHandleRef,
  onChange,
  onSave,
}: FileTabTextBodyProps) {
  const { editorType } = useEditorTypeSetting();
  const isLastFocusedFileTab = useWorkbenchStore(
    (state) =>
      state.lastFocusedPanelByWorkspace[workspaceId]?.file?.panelId === api.id,
  );
  const isLspEligible = useWorkspaceStore(
    (state) => state.activeWorkspaceId === workspaceId,
  );
  const isEditorShown =
    editorType !== "neovim" || (isVisible && isLastFocusedFileTab);

  return (
    <>
      <div
        className="min-h-0 flex-1 overflow-hidden"
        data-lsp-surface="files-page"
      >
        {isEditorShown ? (
          <FilesActiveEditor
            ref={editorHandleRef}
            language={language}
            onChange={onChange}
            onSave={onSave}
            workspaceId={workspaceId}
            filePath={path}
            isLspEligible={isLspEligible}
            autoFocus={isFocused}
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <Button variant="outline" size="sm" onClick={() => api.setActive()}>
              Click to edit in Neovim
            </Button>
          </div>
        )}
      </div>
      <ProblemsPanel
        workspaceId={workspaceId}
        filePath={path}
        onNavigate={(line) => editorHandleRef.current?.revealLine(line)}
      />
    </>
  );
}

export function FileTabEditor(props: FileTabEditorProps) {
  const { api, workspaceId, path, language, isFocused, isVisible } = props;
  const panelId = api.id;
  const editorHandleRef = useRef<EditorHandle>(null);
  const { save, isSaving } = useFileTabSave(workspaceId, path);
  const viewMode = useFileTabViewMode(workspaceId, path);

  const handleSave = useCallback(() => void save(), [save]);
  const handleChange = useCallback(
    (content: string) =>
      useEditorStore.getState().updateFileContent(path, content),
    [path],
  );

  useEffect(() => {
    if (!isFocused) return;
    setFocusedFileTabCommands({
      tabId: panelId,
      save: handleSave,
      focusEditor: () => editorHandleRef.current?.focus(),
    });
    return () => clearFocusedFileTabCommands(panelId);
  }, [isFocused, handleSave, panelId]);

  const renderBody = (bodyKind: FileTabBodyKind) => {
    switch (bodyKind) {
      case "preview":
        return (
          <FileViewer
            workspaceId={workspaceId}
            filePath={path}
            content=""
            language={language}
            onChange={handleChange}
          />
        );
      case "diff":
        // Monaco's diff panes force `visibility: visible` and would paint
        // through dockview's hidden overlay, so a hidden tab drops its diff.
        return isVisible ? (
          <WorkbenchDiffView
            workspaceId={workspaceId}
            filePath={path}
            staged={viewMode.isStagedDiff}
          />
        ) : null;
      case "text":
        return (
          <FileTabTextBody
            {...props}
            editorHandleRef={editorHandleRef}
            onChange={handleChange}
            onSave={handleSave}
          />
        );
      default: {
        const unhandledBodyKind: never = bodyKind;
        throw new Error(
          `Unhandled file tab body: ${String(unhandledBodyKind)}`,
        );
      }
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <FileTabToolbar
        workspaceId={workspaceId}
        path={path}
        language={language}
        viewMode={viewMode}
        isSaving={isSaving}
        onSave={handleSave}
      />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {renderBody(bodyKindOf(language, viewMode))}
      </div>
    </div>
  );
}

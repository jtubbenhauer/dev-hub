import { Loader2, Save } from "lucide-react";
import { FileViewToggle } from "@/components/chat/file-view-toggle";
import { CsvPreviewToggle } from "@/components/editor/csv-preview";
import { FileDiagnosticCounts } from "@/components/editor/file-diagnostic-counts";
import { FileDownloadButton } from "@/components/editor/file-download-button";
import { LspStatusToggle } from "@/components/editor/lsp-status-toggle";
import { MarkdownPreviewToggle } from "@/components/editor/markdown-preview";
import { Button } from "@/components/ui/button";
import type { FileTabViewMode } from "@/components/workbench/tabs/use-file-tab-view-mode";
import { isTextEditorLanguage } from "@/lib/file-preview";
import { findOwnFileBuffer } from "@/lib/files/own-file-buffer";
import { useEditorStore } from "@/stores/editor-store";

interface FileTabFile {
  readonly workspaceId: string;
  readonly path: string;
  readonly language: string;
}

interface FileTabToolbarProps extends FileTabFile {
  readonly viewMode: FileTabViewMode;
  readonly isSaving: boolean;
  readonly onSave: () => void;
}

// Reads the buffer text itself, so typing re-renders only this button.
function FileTabDownloadButton({ workspaceId, path, language }: FileTabFile) {
  const content = useEditorStore(
    (state) =>
      findOwnFileBuffer(state.openFiles, workspaceId, path)?.content ?? "",
  );
  return (
    <FileDownloadButton
      workspaceId={workspaceId}
      filePath={path}
      language={language}
      content={content}
      className="h-7 w-7 p-0"
      iconClassName="h-3.5 w-3.5"
    />
  );
}

export function FileTabToolbar({
  workspaceId,
  path,
  language,
  viewMode,
  isSaving,
  onSave,
}: FileTabToolbarProps) {
  const isDirty = useEditorStore(
    (state) =>
      findOwnFileBuffer(state.openFiles, workspaceId, path)?.isDirty ?? false,
  );
  const isTextFile = isTextEditorLanguage(language);

  return (
    <div className="bg-muted/30 flex shrink-0 items-center gap-1.5 border-b px-2 py-1.5">
      <span
        className="text-muted-foreground min-w-0 flex-1 truncate font-mono text-xs"
        title={path}
      >
        {path}
      </span>
      <FileDiagnosticCounts workspaceId={workspaceId} filePath={path} />
      <LspStatusToggle />
      {viewMode.canDiff && (
        <FileViewToggle mode={viewMode.mode} onChange={viewMode.setMode} />
      )}
      <MarkdownPreviewToggle
        language={language}
        filePath={path}
        size="sm"
        className="h-7 w-7 p-0"
      />
      {isTextFile && (
        <CsvPreviewToggle filePath={path} size="sm" className="h-7 w-7 p-0" />
      )}
      {isTextFile && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 px-1.5 text-xs"
          data-testid="file-tab-save"
          onClick={onSave}
          disabled={isSaving || !isDirty}
        >
          {isSaving ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Save className="h-3.5 w-3.5" />
          )}
          <span className="hidden md:inline">Save</span>
        </Button>
      )}
      <FileTabDownloadButton
        workspaceId={workspaceId}
        path={path}
        language={language}
      />
    </div>
  );
}

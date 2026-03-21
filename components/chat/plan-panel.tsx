"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { X, Save, FileText, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EditorSwitcher } from "@/components/editor/editor-switcher";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { PlanFile } from "@/app/api/files/plans/route";

interface PlanPanelProps {
  workspaceId: string;
  workspaceName: string;
  sessionDirectory?: string;
  isOpen: boolean;
  onClose: () => void;
  onPlanFilesChange: (hasFiles: boolean) => void;
}

interface FileContentResponse {
  content: string;
}

async function fetchPlanFiles(
  workspaceId: string,
  directory?: string,
): Promise<PlanFile[]> {
  const params = new URLSearchParams({ workspaceId });
  if (directory) params.set("directory", directory);
  const response = await fetch(`/api/files/plans?${params.toString()}`);
  if (!response.ok) return [];
  const data = await response.json();
  return data.files ?? [];
}

async function fetchFileContent(
  workspaceId: string,
  filePath: string,
): Promise<string> {
  const params = new URLSearchParams({ workspaceId, path: filePath });
  const response = await fetch(`/api/files/content?${params.toString()}`);
  if (!response.ok) throw new Error("Failed to load file");
  const data: FileContentResponse = await response.json();
  return data.content;
}

async function saveFileContent(
  workspaceId: string,
  filePath: string,
  content: string,
): Promise<void> {
  const response = await fetch("/api/files/content", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspaceId, path: filePath, content }),
  });
  if (!response.ok) throw new Error("Failed to save file");
}

function pickBestPlanFile(files: PlanFile[], workspaceName: string): PlanFile {
  const slug = workspaceName.toLowerCase().replace(/\s+/g, "-");
  const nameMatch = files.find((f) => f.name.toLowerCase().includes(slug));
  return nameMatch ?? files[0];
}

export function PlanPanel({
  workspaceId,
  workspaceName,
  sessionDirectory,
  isOpen,
  onClose,
  onPlanFilesChange,
}: PlanPanelProps) {
  const [planFiles, setPlanFiles] = useState<PlanFile[]>([]);
  const [activePlanPath, setActivePlanPath] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const [isLoadingContent, setIsLoadingContent] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const isDirty = content !== savedContent;
  const hasAutoSelected = useRef(false);

  const loadPlanFiles = useCallback(async () => {
    setIsLoadingFiles(true);
    try {
      const files = await fetchPlanFiles(workspaceId, sessionDirectory);
      setPlanFiles(files);
      onPlanFilesChange(files.length > 0);

      if (!hasAutoSelected.current && files.length > 0) {
        hasAutoSelected.current = true;
        const best = pickBestPlanFile(files, workspaceName);
        setActivePlanPath(best.path);
      }
    } catch {
      // Silently fail — empty state handles it
    } finally {
      setIsLoadingFiles(false);
    }
  }, [workspaceId, sessionDirectory, workspaceName, onPlanFilesChange]);

  useEffect(() => {
    hasAutoSelected.current = false;
    setPlanFiles([]);
    setActivePlanPath(null);
    setContent("");
    setSavedContent("");
    loadPlanFiles();
  }, [loadPlanFiles]);

  // Load content when active file changes
  useEffect(() => {
    if (!activePlanPath) return;

    let cancelled = false;
    setIsLoadingContent(true);
    setSaveError(null);

    fetchFileContent(workspaceId, activePlanPath)
      .then((text) => {
        if (cancelled) return;
        setContent(text);
        setSavedContent(text);
      })
      .catch(() => {
        if (cancelled) return;
        setContent("");
        setSavedContent("");
      })
      .finally(() => {
        if (!cancelled) setIsLoadingContent(false);
      });

    return () => {
      cancelled = true;
    };
  }, [workspaceId, activePlanPath]);

  const handleSave = useCallback(async () => {
    if (!activePlanPath || !isDirty || isSaving) return;
    setIsSaving(true);
    setSaveError(null);
    try {
      await saveFileContent(workspaceId, activePlanPath, content);
      setSavedContent(content);
    } catch {
      setSaveError("Failed to save");
    } finally {
      setIsSaving(false);
    }
  }, [workspaceId, activePlanPath, content, isDirty, isSaving]);

  const handleFileChange = useCallback(
    (newPath: string) => {
      if (isDirty) {
        const confirmed = window.confirm(
          "You have unsaved changes. Switch files and discard them?",
        );
        if (!confirmed) return;
      }
      setActivePlanPath(newPath);
    },
    [isDirty],
  );

  const handleClose = useCallback(() => {
    if (isDirty) {
      const confirmed = window.confirm(
        "You have unsaved changes. Close and discard them?",
      );
      if (!confirmed) return;
    }
    onClose();
  }, [isDirty, onClose]);

  // Close panel on Escape key
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Don't intercept if a Radix popover/select is open
      if (document.querySelector("[data-radix-popper-content-wrapper]")) return;
      e.preventDefault();
      handleClose();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, handleClose]);

  if (!isOpen) return null;

  return (
    <div
      className={cn(
        "flex h-full min-w-0 flex-col overflow-hidden",
        "animate-in fade-in duration-150",
      )}
    >
      {/* Header */}
      <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2">
        <FileText className="text-muted-foreground size-4 shrink-0" />

        {planFiles.length === 0 && !isLoadingFiles ? (
          <span className="text-muted-foreground flex-1 truncate text-sm">
            No plan files found
          </span>
        ) : (
          <Select
            value={activePlanPath ?? undefined}
            onValueChange={handleFileChange}
            disabled={isLoadingFiles || planFiles.length === 0}
          >
            <SelectTrigger
              size="sm"
              className="h-7 flex-1 border-0 bg-transparent px-1 shadow-none focus-visible:ring-0"
            >
              <SelectValue
                placeholder={
                  isLoadingFiles ? "Loading..." : "Select a plan file"
                }
              />
            </SelectTrigger>
            <SelectContent align="start">
              {planFiles.map((file) => (
                <SelectItem key={file.path} value={file.path}>
                  {file.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <div className="flex shrink-0 items-center gap-1">
          {isDirty && (
            <span
              className="size-2 rounded-full bg-amber-500"
              title="Unsaved changes"
            />
          )}

          <Button
            size="icon-xs"
            variant="ghost"
            onClick={handleSave}
            disabled={!isDirty || isSaving || !activePlanPath}
            title="Save (Ctrl+S)"
          >
            {isSaving ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Save className="size-3.5" />
            )}
          </Button>

          <Button
            size="icon-xs"
            variant="ghost"
            onClick={handleClose}
            title="Close panel"
          >
            <X className="size-3.5" />
          </Button>
        </div>
      </div>

      {saveError && (
        <div className="bg-destructive/10 text-destructive shrink-0 px-3 py-1.5 text-xs">
          {saveError}
        </div>
      )}

      {/* Editor area */}
      <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
        {isLoadingContent && (
          <div className="bg-background/80 absolute inset-0 z-10 flex items-center justify-center">
            <Loader2 className="text-muted-foreground size-5 animate-spin" />
          </div>
        )}

        {!activePlanPath && !isLoadingFiles ? (
          <div className="flex h-full items-center justify-center p-6 text-center">
            <p className="text-muted-foreground text-sm">
              {planFiles.length === 0
                ? "No plan files found in this workspace."
                : "Select a plan file above to start editing."}
            </p>
          </div>
        ) : (
          <EditorSwitcher
            content={content}
            language="markdown"
            onChange={setContent}
            onSave={handleSave}
            workspaceId={workspaceId}
            filePath={activePlanPath ?? undefined}
            autoFocus
          />
        )}
      </div>
    </div>
  );
}

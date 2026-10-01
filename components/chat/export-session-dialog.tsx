"use client";

import { useState, type SubmitEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { openFileInSidePanel } from "@/lib/side-panel-open-file";
import { cn } from "@/lib/utils";
import { useSidePanelStore } from "@/stores/side-panel-store";

interface ExportSessionDialogProps {
  readonly workspaceId: string;
  readonly sessionId: string;
  readonly defaultThinking: boolean;
  readonly defaultToolDetails: boolean;
  readonly onClose: () => void;
}

type ExportOption =
  | "thinking"
  | "toolDetails"
  | "assistantMetadata"
  | "openWithoutSaving";

const EXPORT_OPTIONS = [
  { key: "thinking", label: "Include thinking" },
  { key: "toolDetails", label: "Include tool details" },
  { key: "assistantMetadata", label: "Include assistant metadata" },
  { key: "openWithoutSaving", label: "Open without saving" },
] as const satisfies ReadonlyArray<{ key: ExportOption; label: string }>;

type ExportResponse =
  | { readonly kind: "saved"; readonly path: string }
  | { readonly kind: "preview"; readonly markdown: string }
  | { readonly kind: "failed"; readonly reason: string | undefined };

function readStringField(
  payload: unknown,
  key: "path" | "markdown" | "error" | "detail",
): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const value: unknown = Reflect.get(payload, key);
  return typeof value === "string" ? value : null;
}

function parseExportResponse(isOk: boolean, payload: unknown): ExportResponse {
  if (!isOk) {
    return {
      kind: "failed",
      reason:
        readStringField(payload, "detail") ??
        readStringField(payload, "error") ??
        undefined,
    };
  }
  const markdown = readStringField(payload, "markdown");
  if (markdown !== null) return { kind: "preview", markdown };
  const path = readStringField(payload, "path");
  if (path !== null) return { kind: "saved", path };
  return { kind: "failed", reason: "Unexpected response from the server" };
}

// dev-hub's take on the TUI's /export dialog: same options and defaults, but
// the saved file opens in the side panel instead of $EDITOR, and "Open without
// saving" shows a read-only preview instead of a throwaway editor buffer.
export function ExportSessionDialog({
  workspaceId,
  sessionId,
  defaultThinking,
  defaultToolDetails,
  onClose,
}: ExportSessionDialogProps) {
  const [filename, setFilename] = useState(
    `session-${sessionId.slice(0, 8)}.md`,
  );
  const [options, setOptions] = useState<Record<ExportOption, boolean>>({
    thinking: defaultThinking,
    toolDetails: defaultToolDetails,
    assistantMetadata: true,
    openWithoutSaving: false,
  });
  const [isExporting, setIsExporting] = useState(false);
  const [previewMarkdown, setPreviewMarkdown] = useState<string | null>(null);

  const trimmedFilename = filename.trim();
  const canSubmit =
    !isExporting && (options.openWithoutSaving || trimmedFilename !== "");

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    setIsExporting(true);
    try {
      const response = await fetch("/api/sessions/export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          sessionId,
          filename: trimmedFilename,
          ...options,
        }),
      });
      const result = parseExportResponse(response.ok, await response.json());
      switch (result.kind) {
        case "failed":
          toast.error("Failed to export session", {
            description: result.reason,
          });
          return;
        case "preview":
          setPreviewMarkdown(result.markdown);
          return;
        case "saved":
          toast.success(`Session exported to ${result.path}`);
          onClose();
          // A tab already showing this file would otherwise keep the old text.
          await useSidePanelStore
            .getState()
            .reloadFileFromDisk(workspaceId, result.path);
          await openFileInSidePanel(workspaceId, result.path, () =>
            toast.error("Could not open file"),
          );
          return;
        default: {
          const unhandled: never = result;
          throw new Error(`Unhandled export result: ${String(unhandled)}`);
        }
      }
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      toast.error("Failed to export session", { description: error.message });
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
    >
      <DialogContent className={cn(previewMarkdown !== null && "sm:max-w-3xl")}>
        {previewMarkdown === null ? (
          <form onSubmit={handleSubmit} className="grid gap-4">
            <DialogHeader>
              <DialogTitle>Export session transcript</DialogTitle>
              <DialogDescription>
                Saves the full conversation as Markdown in the workspace root
                and opens it in the side panel.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-2">
              <Label htmlFor="export-session-filename">Filename</Label>
              <Input
                id="export-session-filename"
                value={filename}
                onChange={(event) => setFilename(event.target.value)}
                spellCheck={false}
              />
            </div>
            <div className="grid gap-3">
              {EXPORT_OPTIONS.map(({ key, label }) => (
                <div key={key} className="flex items-center gap-2">
                  <Checkbox
                    id={`export-session-${key}`}
                    checked={options[key]}
                    onCheckedChange={(checked) =>
                      setOptions((current) => ({
                        ...current,
                        [key]: checked === true,
                      }))
                    }
                  />
                  <Label htmlFor={`export-session-${key}`}>{label}</Label>
                </div>
              ))}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={!canSubmit}>
                {isExporting ? "Exporting…" : "Export"}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Session transcript</DialogTitle>
              <DialogDescription>
                Read-only preview. Nothing was saved.
              </DialogDescription>
            </DialogHeader>
            <pre
              data-testid="export-session-preview"
              className="bg-muted/40 max-h-[60vh] overflow-auto rounded-md border p-3 font-mono text-xs break-words whitespace-pre-wrap"
            >
              {previewMarkdown}
            </pre>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Close
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

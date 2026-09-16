"use client";

import { cn } from "@/lib/utils";
import type { FileViewMode } from "@/components/chat/use-file-view-mode";

interface FileViewToggleProps {
  mode: FileViewMode;
  onChange: (mode: FileViewMode) => void;
}

// Editor|Diff segmented toggle for the chat side panel file header. Only shown
// when the active file can be diffed (in-repo file in a git repo).
export function FileViewToggle({ mode, onChange }: FileViewToggleProps) {
  return (
    <div
      data-testid="file-view-toggle"
      className="flex shrink-0 items-center gap-0.5 rounded-md border p-0.5"
    >
      <button
        type="button"
        data-testid="file-view-toggle-editor"
        aria-pressed={mode === "editor"}
        onClick={() => onChange("editor")}
        className={cn(
          "rounded px-1.5 py-0.5 text-[11px] transition-colors",
          mode === "editor"
            ? "bg-accent text-foreground"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        Editor
      </button>
      <button
        type="button"
        data-testid="file-view-toggle-diff"
        aria-pressed={mode === "diff"}
        onClick={() => onChange("diff")}
        className={cn(
          "rounded px-1.5 py-0.5 text-[11px] transition-colors",
          mode === "diff"
            ? "bg-accent text-foreground"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        Diff
      </button>
    </div>
  );
}

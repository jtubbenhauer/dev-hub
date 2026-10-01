"use client";

import type { ComponentProps, ReactNode } from "react";
import { Eye, Pencil } from "lucide-react";
import "highlight.js/styles/github.css";
import { Button } from "@/components/ui/button";
import { useEditorStore } from "@/stores/editor-store";
import { GitHubMarkdown } from "@/components/git/github-markdown";
import { stripFrontmatter, isMarkdownLanguage } from "@/lib/file-preview";

interface MarkdownPreviewToggleProps {
  language: string;
  filePath?: string;
  size?: ComponentProps<typeof Button>["size"];
  className?: string;
}

// Header button that turns the rendered markdown preview on and off.
// Renders nothing for non-markdown files so headers stay unchanged.
export function MarkdownPreviewToggle({
  language,
  filePath,
  size = "icon-xs",
  className,
}: MarkdownPreviewToggleProps) {
  const markdownPreviewPath = useEditorStore((s) => s.markdownPreviewPath);

  if (!isMarkdownLanguage(language)) {
    return null;
  }

  const currentFilePath = filePath ?? "";
  const isPreview = markdownPreviewPath === currentFilePath;

  return (
    <Button
      variant="ghost"
      size={size}
      className={className}
      aria-label={isPreview ? "Edit markdown" : "Preview markdown"}
      title={isPreview ? "Back to editor" : "Show rendered markdown"}
      onClick={() =>
        useEditorStore
          .getState()
          .setMarkdownPreviewPath(isPreview ? null : currentFilePath)
      }
    >
      {isPreview ? (
        <Pencil className="size-3.5" />
      ) : (
        <Eye className="size-3.5" />
      )}
    </Button>
  );
}

interface MarkdownPreviewFrameProps {
  content: string;
  language: string;
  filePath?: string;
  children: ReactNode;
}

// Overlays an editor with the rendered markdown while preview is on.
// The editor stays mounted (just hidden) so Neovim/Monaco state survives toggling.
export function MarkdownPreviewFrame({
  content,
  language,
  filePath,
  children,
}: MarkdownPreviewFrameProps) {
  const markdownPreviewPath = useEditorStore((s) => s.markdownPreviewPath);
  const isPreview =
    isMarkdownLanguage(language) && markdownPreviewPath === (filePath ?? "");

  if (!isPreview) {
    return <>{children}</>;
  }

  return (
    <div className="relative h-full w-full">
      <div className="invisible h-full w-full" aria-hidden>
        {children}
      </div>
      <div
        data-testid="markdown-preview"
        className="bg-background absolute inset-0 overflow-auto px-6 py-4"
      >
        <GitHubMarkdown content={stripFrontmatter(content)} />
      </div>
    </div>
  );
}

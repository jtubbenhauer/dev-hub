"use client";

import { memo, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { GITHUB_MARKDOWN_CONTAINER_CLASS } from "@/components/markdown/markdown-classes";
import type * as MarkdownRenderers from "@/components/markdown/markdown-renderers";
import type { GitHubMarkdownProps } from "@/components/markdown/github-markdown-renderer";
import type { ChatMarkdownProps } from "@/components/markdown/chat-markdown-renderer";

type MarkdownRenderersModule = typeof MarkdownRenderers;

// The only import() of the markdown stack (react-markdown, rehype-highlight,
// highlight.js). Every route shares this one chunk group, so the code is
// downloaded and parsed once and only when markdown is actually rendered.
let loadedRenderers: MarkdownRenderersModule | null = null;
let pendingRenderers: Promise<MarkdownRenderersModule> | null = null;

export function preloadMarkdownRenderers(): Promise<MarkdownRenderersModule> {
  if (!pendingRenderers) {
    pendingRenderers = import("@/components/markdown/markdown-renderers").then(
      (renderers) => {
        loadedRenderers = renderers;
        return renderers;
      },
      (error: unknown) => {
        pendingRenderers = null;
        throw error;
      },
    );
  }
  return pendingRenderers;
}

// Returns the renderers synchronously once loaded, so later mounts never
// show the fallback.
function useMarkdownRenderers(): MarkdownRenderersModule | null {
  const [renderers, setRenderers] = useState(loadedRenderers);

  useEffect(() => {
    if (renderers) return;
    let isMounted = true;
    preloadMarkdownRenderers().then(
      (loaded) => {
        if (isMounted) setRenderers(loaded);
      },
      (error: unknown) => {
        console.error("Failed to load the markdown renderer", error);
      },
    );
    return () => {
      isMounted = false;
    };
  }, [renderers]);

  return renderers;
}

// Raw text in the same container while the renderer loads, so the block
// keeps its typography and roughly its height.
function RawMarkdownFallback({ content }: { content: string }) {
  return (
    <p className="whitespace-pre-wrap" data-markdown-loading="">
      {content}
    </p>
  );
}

// Empty content renders nothing and must not trigger the download.
export const LazyGitHubMarkdown = memo(function LazyGitHubMarkdown({
  content,
  className,
}: GitHubMarkdownProps) {
  if (!content) return null;
  return <LoadedGitHubMarkdown content={content} className={className} />;
});

function LoadedGitHubMarkdown({ content, className }: GitHubMarkdownProps) {
  const renderers = useMarkdownRenderers();
  if (!renderers) {
    return (
      <div className={cn(GITHUB_MARKDOWN_CONTAINER_CLASS, className)}>
        <RawMarkdownFallback content={content} />
      </div>
    );
  }
  return (
    <renderers.GitHubMarkdownRenderer content={content} className={className} />
  );
}

export const LazyChatMarkdown = memo(function LazyChatMarkdown(
  props: ChatMarkdownProps,
) {
  const renderers = useMarkdownRenderers();
  if (!renderers) return <RawMarkdownFallback content={props.content} />;
  return <renderers.ChatMarkdownRenderer {...props} />;
});

export const LazyTaskMarkdown = memo(function LazyTaskMarkdown({
  content,
}: {
  content: string;
}) {
  const renderers = useMarkdownRenderers();
  if (!renderers) return <RawMarkdownFallback content={content} />;
  return <renderers.TaskMarkdownRenderer content={content} />;
});

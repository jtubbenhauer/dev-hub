"use client";

import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import rehypeHighlight from "rehype-highlight";
import { cn } from "@/lib/utils";
import { replaceEmoji } from "@/lib/emoji";

export const GitHubMarkdown = memo(function GitHubMarkdown({
  content,
  className,
}: {
  content: string;
  className?: string;
}) {
  if (!content) return null;

  return (
    <div
      className={cn(
        "prose prose-sm dark:prose-invert max-w-none break-words",
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, rehypeSanitize, rehypeHighlight]}
      >
        {replaceEmoji(content)}
      </ReactMarkdown>
    </div>
  );
});

import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import rehypeHighlight from "rehype-highlight";
import { cn } from "@/lib/utils";
import { replaceEmoji } from "@/lib/emoji";
import { GITHUB_MARKDOWN_CONTAINER_CLASS } from "@/components/markdown/markdown-classes";

export interface GitHubMarkdownProps {
  content: string;
  className?: string;
}

export const GitHubMarkdownRenderer = memo(function GitHubMarkdownRenderer({
  content,
  className,
}: GitHubMarkdownProps) {
  if (!content) return null;

  return (
    <div className={cn(GITHUB_MARKDOWN_CONTAINER_CLASS, className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, rehypeSanitize, rehypeHighlight]}
      >
        {replaceEmoji(content)}
      </ReactMarkdown>
    </div>
  );
});

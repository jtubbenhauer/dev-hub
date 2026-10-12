import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export { GitHubMarkdownRenderer } from "@/components/markdown/github-markdown-renderer";
export { ChatMarkdownRenderer } from "@/components/markdown/chat-markdown-renderer";

export function TaskMarkdownRenderer({ content }: { content: string }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>;
}

"use client";

import "highlight.js/styles/github.css";
import {
  LazyChatMarkdown,
  preloadMarkdownRenderers,
} from "@/components/markdown/lazy-markdown";

// Chat messages are fetched after hydration, so starting the shared
// markdown chunk as soon as the chat code evaluates lets it finish before
// the first message renders (no flash of raw markdown).
if (typeof window !== "undefined") {
  void preloadMarkdownRenderers().catch(() => undefined);
}

export const MarkdownContent = LazyChatMarkdown;

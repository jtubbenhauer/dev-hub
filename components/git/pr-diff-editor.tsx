"use client";

import { forwardRef } from "react";
import dynamic from "next/dynamic";
import type { GitHubPrFileContent, GitHubReviewComment } from "@/types";

const MonacoPrDiffEditor = dynamic(
  () =>
    import("@/components/git/monaco-pr-diff-editor").then(
      (m) => m.MonacoPrDiffEditor,
    ),
  {
    ssr: false,
    loading: () => <div className="bg-muted h-full w-full animate-pulse" />,
  },
);

export interface PrDiffEditorHandle {
  focus: () => void;
  blur: () => void;
}

interface PrDiffEditorProps {
  fileContent: GitHubPrFileContent;
  comments: GitHubReviewComment[];
  isLoading: boolean;
  isSubmittingComment: boolean;
  onAddComment: (
    body: string,
    line: number,
    startLine: number,
  ) => Promise<void>;
  onReplyToComment: (body: string, inReplyToId: number) => Promise<void>;
  onOpenFileList?: () => void;
}

export const PrDiffEditor = forwardRef<PrDiffEditorHandle, PrDiffEditorProps>(
  function PrDiffEditor(props, ref) {
    return <MonacoPrDiffEditor ref={ref} {...props} />;
  },
);

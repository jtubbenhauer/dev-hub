"use client";

import { forwardRef } from "react";
import dynamic from "next/dynamic";
import type { GitHubPrFileContent, GitHubReviewComment } from "@/types";
import type { ReviewDraft } from "@/stores/review-draft-store";

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
  drafts: ReviewDraft[];
  resolvedLines: Set<number>;
  outdatedLines: Set<number>;
  isLoading: boolean;
  isSubmittingComment: boolean;
  onAddComment: (
    body: string,
    line: number,
    startLine: number,
    isInDiffHunk: boolean,
    side: "LEFT" | "RIGHT",
  ) => Promise<void>;
  onReplyToComment: (body: string, inReplyToId: number) => Promise<void>;
  onEditComment: (commentId: number, body: string) => Promise<void>;
  onDeleteComment: (commentId: number) => Promise<void>;
  onDeleteDraft: (draftId: string) => void;
  onEditDraft: (draftId: string, body: string) => void;
  onResolveThread: (line: number, resolved: boolean) => void;
  currentUserLogin: string | null;
  onOpenFileList?: () => void;
}

export const PrDiffEditor = forwardRef<PrDiffEditorHandle, PrDiffEditorProps>(
  function PrDiffEditor(props, ref) {
    return <MonacoPrDiffEditor ref={ref} {...props} />;
  },
);

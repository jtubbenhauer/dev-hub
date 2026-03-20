"use client";

import { forwardRef } from "react";
import dynamic from "next/dynamic";
import { useEditorTypeSetting } from "@/hooks/use-settings";
import type { ReviewFile } from "@/types";

const MonacoReviewEditor = dynamic(
  () =>
    import("@/components/review/monaco-review-editor").then(
      (m) => m.MonacoReviewEditor,
    ),
  {
    ssr: false,
    loading: () => <div className="h-full w-full animate-pulse bg-muted" />,
  },
);

const NeovimReviewEditor = dynamic(
  () =>
    import("@/components/review/neovim-review-editor").then(
      (m) => m.NeovimReviewEditor,
    ),
  {
    ssr: false,
    loading: () => <div className="h-full w-full animate-pulse bg-muted" />,
  },
);

export interface ReviewEditorHandle {
  focus: () => void;
  blur: () => void;
}

interface ReviewEditorProps {
  fileContent: {
    original: string;
    current: string;
    path: string;
    language: string;
  };
  file?: ReviewFile;
  workspaceId: string;
  isLoading: boolean;
  onToggleReviewed?: (file: ReviewFile) => void;
  onMarkAndNext?: (file: ReviewFile) => void;
  onOpenFileList?: () => void;
}

export const ReviewEditor = forwardRef<ReviewEditorHandle, ReviewEditorProps>(
  function ReviewEditor(props, ref) {
    const { editorType } = useEditorTypeSetting();

    if (editorType === "neovim") {
      return <NeovimReviewEditor ref={ref} {...props} />;
    }

    return <MonacoReviewEditor ref={ref} {...props} />;
  },
);

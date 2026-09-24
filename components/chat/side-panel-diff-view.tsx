"use client";

import dynamic from "next/dynamic";
import { useGitFileContent, useGitFileContentAtRef } from "@/hooks/use-git";

// Heavy Monaco editor — load via next/dynamic (never a static import in chat
// components). Mirrors components/git/pr-diff-editor.tsx.
const MonacoReviewEditor = dynamic(
  () =>
    import("@/components/review/monaco-review-editor").then(
      (m) => m.MonacoReviewEditor,
    ),
  {
    ssr: false,
    loading: () => <div className="bg-muted h-full w-full animate-pulse" />,
  },
);

// Read-only diff surface for the chat side panel (Git tab). filePath MUST be
// repo-relative — callers guarantee this; we never forward an absolute path.
export function SidePanelDiffView({
  workspaceId,
  filePath,
  staged = false,
  baseRef = null,
}: {
  workspaceId: string;
  filePath: string;
  staged?: boolean;
  baseRef?: string | null;
}) {
  const workingChangesQuery = useGitFileContent(
    baseRef ? null : workspaceId,
    filePath,
    staged,
  );
  const branchCompareQuery = useGitFileContentAtRef(
    baseRef ? workspaceId : null,
    filePath,
    baseRef,
  );
  const { data, isLoading, isPlaceholderData, error } = baseRef
    ? branchCompareQuery
    : workingChangesQuery;

  // Error-first: a query error wins even when `data` is undefined.
  if (error) {
    return (
      <div className="text-destructive p-3 text-xs" data-testid="diff-error">
        {error instanceof Error ? error.message : "Failed to load file"}
      </div>
    );
  }

  // keepPreviousData means a rapid file switch can briefly hand us the PREVIOUS
  // file with isLoading false. Guard on data.path so we never show — or allow
  // commenting on — the wrong file.
  if (isLoading || isPlaceholderData || !data || data.path !== filePath) {
    return (
      <div
        className="bg-muted h-full w-full animate-pulse"
        data-testid="diff-loading"
      />
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div
        className="text-muted-foreground truncate border-b px-3 py-1.5 font-mono text-xs"
        data-testid="diff-header"
        title={filePath}
      >
        {filePath}
      </div>
      <div className="min-h-0 flex-1">
        <MonacoReviewEditor
          fileContent={data}
          workspaceId={workspaceId}
          isLoading={isLoading}
          showToolbar={false}
          forceSideBySide={true}
          readOnly={true}
        />
      </div>
    </div>
  );
}

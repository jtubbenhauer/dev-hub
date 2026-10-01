"use client";

import type { ComponentProps, ReactNode } from "react";
import dynamic from "next/dynamic";
import { Pencil, Table2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isCsvPath } from "@/lib/file-preview";
import { cn } from "@/lib/utils";
import { useEditorStore } from "@/stores/editor-store";

const CsvTable = dynamic(
  () => import("@/components/editor/csv-table").then((m) => m.CsvTable),
  {
    ssr: false,
    loading: () => <div className="bg-muted h-full w-full animate-pulse" />,
  },
);

interface CsvPreviewToggleProps {
  filePath?: string;
  size?: ComponentProps<typeof Button>["size"];
  className?: string;
}

export function CsvPreviewToggle({
  filePath,
  size = "icon-xs",
  className,
}: CsvPreviewToggleProps) {
  const csvPreviewPath = useEditorStore((s) => s.csvPreviewPath);

  if (filePath === undefined || !isCsvPath(filePath)) {
    return null;
  }

  const isPreview = csvPreviewPath === filePath;

  return (
    <Button
      variant="ghost"
      size={size}
      className={className}
      aria-label={isPreview ? "Edit CSV" : "Show CSV as table"}
      title={isPreview ? "Back to editor" : "Show as table"}
      onClick={() =>
        useEditorStore.getState().setCsvPreviewPath(isPreview ? null : filePath)
      }
    >
      {isPreview ? (
        <Pencil className="size-3.5" />
      ) : (
        <Table2 className="size-3.5" />
      )}
    </Button>
  );
}

interface CsvPreviewFrameProps {
  content: string;
  filePath?: string;
  workspaceId?: string;
  children: ReactNode;
}

// The wrapper renders for every file, not just CSVs in table mode, so that
// toggling the table or switching files never remounts the editor inside it.
export function CsvPreviewFrame({
  content,
  filePath,
  workspaceId,
  children,
}: CsvPreviewFrameProps) {
  const csvPreviewPath = useEditorStore((s) => s.csvPreviewPath);
  const tableFilePath =
    filePath !== undefined && isCsvPath(filePath) && csvPreviewPath === filePath
      ? filePath
      : null;
  const isTableShown = tableFilePath !== null;

  return (
    <div className="relative h-full w-full">
      <div
        className={cn("h-full w-full", isTableShown && "invisible")}
        aria-hidden={isTableShown || undefined}
      >
        {children}
      </div>
      {tableFilePath !== null && (
        <div
          data-testid="csv-preview"
          className="bg-background absolute inset-0"
        >
          <CsvTable
            content={content}
            filePath={tableFilePath}
            workspaceId={workspaceId}
          />
        </div>
      )}
    </div>
  );
}

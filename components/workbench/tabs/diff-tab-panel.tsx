"use client";

import { FileCode } from "lucide-react";
import { useRouter } from "next/navigation";
import type { IDockviewPanelProps } from "dockview-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { WorkbenchDiffView } from "@/components/workbench/workbench-diff-view";
import { WorkbenchPanelFrame } from "@/components/workbench/workbench-panel-frame";
import { useFileTabsSetting } from "@/hooks/use-settings";
import { openFileInWorkbench } from "@/lib/workbench/open-in-workbench";
import type {
  DiffTabParams,
  WorkbenchTabParams,
} from "@/lib/workbench/tab-descriptors";

function diffSourceLabel(params: DiffTabParams): string {
  switch (params.source) {
    case "working":
      return "Working";
    case "staged":
      return "Staged";
    case "compare":
      return `vs ${params.baseRef ?? ""}`;
    default: {
      const unhandledSource: never = params.source;
      throw new Error(`Unhandled diff source: ${String(unhandledSource)}`);
    }
  }
}

function DiffTabBody({ params }: { readonly params: DiffTabParams }) {
  const { workspaceId, path, source, baseRef } = params;
  const router = useRouter();
  const { isFileTabsDisabled } = useFileTabsSetting();

  const handleOpenFile = () => {
    void openFileInWorkbench({
      workspaceId,
      path,
      isFileTabsDisabled,
      navigate: (href) => router.push(href),
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b px-3 py-1.5">
        <span
          className="min-w-0 flex-1 truncate font-mono text-xs"
          data-testid="diff-tab-path"
          title={path}
        >
          {path}
        </span>
        <Badge variant="secondary">{diffSourceLabel(params)}</Badge>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={handleOpenFile}
        >
          <FileCode className="size-3.5" />
          Open file
        </Button>
      </div>
      <div className="min-h-0 flex-1">
        <WorkbenchDiffView
          workspaceId={workspaceId}
          filePath={path}
          staged={source === "staged"}
          baseRef={source === "compare" ? baseRef : null}
        />
      </div>
    </div>
  );
}

export function DiffTabPanel({
  api,
  params,
}: IDockviewPanelProps<WorkbenchTabParams>) {
  return (
    <WorkbenchPanelFrame api={api}>
      {params.kind === "diff" ? <DiffTabBody params={params} /> : null}
    </WorkbenchPanelFrame>
  );
}

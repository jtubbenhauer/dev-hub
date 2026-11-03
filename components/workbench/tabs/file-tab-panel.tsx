"use client";

import type {
  DockviewApi,
  DockviewPanelApi,
  IDockviewPanelProps,
} from "dockview-react";
import { AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createDockviewLayoutApi } from "@/components/workbench/dockview-layout-api";
import { FileTabEditor } from "@/components/workbench/tabs/file-tab-editor";
import { FileTabLeaderActions } from "@/components/workbench/tabs/file-tab-leader-actions";
import {
  useFileTabBuffer,
  type FileTabBuffer,
} from "@/components/workbench/tabs/use-file-tab-buffer";
import { useWorkbenchPanelState } from "@/components/workbench/use-workbench-panel-state";
import { requestCloseTab } from "@/components/workbench/workbench-close-tab";
import { WorkbenchPanelFrame } from "@/components/workbench/workbench-panel-frame";
import { useEndTerminalSession } from "@/hooks/use-terminal-sessions";
import type { WorkbenchTabParams } from "@/lib/workbench/tab-descriptors";

type FileTabParams = Extract<WorkbenchTabParams, { kind: "file" }>;

interface FileTabNoticeProps {
  readonly message: string;
  readonly onCloseTab: () => void;
}

function FileTabNotice({ message, onCloseTab }: FileTabNoticeProps) {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="flex max-w-sm flex-col items-center gap-3 text-center">
        <AlertCircle aria-hidden className="text-muted-foreground size-8" />
        <p className="text-muted-foreground text-sm">{message}</p>
        <Button variant="outline" size="sm" onClick={onCloseTab}>
          Close tab
        </Button>
      </div>
    </div>
  );
}

interface FileTabBodyProps {
  readonly api: DockviewPanelApi;
  readonly containerApi: DockviewApi;
  readonly params: FileTabParams;
}

function FileTabBody({ api, containerApi, params }: FileTabBodyProps) {
  const { workspaceId, path } = params;
  const { isFocused, isVisible } = useWorkbenchPanelState(api, containerApi);
  const buffer = useFileTabBuffer(workspaceId, path);
  const { mutate: endTerminalSession } = useEndTerminalSession();

  const closeTab = () => {
    requestCloseTab({
      layoutApi: createDockviewLayoutApi(containerApi),
      panelId: api.id,
      endTerminalSession,
    });
  };

  const renderContent = (fileBuffer: FileTabBuffer) => {
    switch (fileBuffer.status) {
      case "ready":
        return (
          <FileTabEditor
            api={api}
            workspaceId={workspaceId}
            path={path}
            language={fileBuffer.language}
            isFocused={isFocused}
            isVisible={isVisible}
          />
        );
      case "loading":
        return (
          <div
            role="status"
            aria-label="Loading file"
            className="flex h-full items-center justify-center"
          >
            <Loader2
              aria-hidden
              className="text-muted-foreground size-5 animate-spin"
            />
          </div>
        );
      case "not-found":
        return (
          <FileTabNotice
            message={`File not found: ${path}`}
            onCloseTab={closeTab}
          />
        );
      case "held-dirty-elsewhere":
        return (
          <FileTabNotice
            message="This file has unsaved changes in another workspace. Save or discard them there first."
            onCloseTab={closeTab}
          />
        );
      default: {
        const unhandledBuffer: never = fileBuffer;
        throw new Error(
          `Unhandled file tab buffer: ${String(unhandledBuffer)}`,
        );
      }
    }
  };

  return (
    <>
      {renderContent(buffer)}
      {isFocused && <FileTabLeaderActions />}
    </>
  );
}

export function FileTabPanel({
  api,
  containerApi,
  params,
}: IDockviewPanelProps<WorkbenchTabParams>) {
  return (
    <WorkbenchPanelFrame api={api}>
      {params.kind === "file" ? (
        <FileTabBody api={api} containerApi={containerApi} params={params} />
      ) : null}
    </WorkbenchPanelFrame>
  );
}

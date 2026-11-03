import { resolveTabWorkspaceId } from "@/lib/files/save-request";
import type { WorkbenchTabParams } from "@/lib/workbench/tab-descriptors";
import type { WorkbenchLayoutApi } from "@/lib/workbench/workbench-layout-api";
import { useEditorStore } from "@/stores/editor-store";
import { useWorkbenchStore } from "@/stores/workbench-store";
import type { OpenFile } from "@/types";

export interface EndTerminalSessionInput {
  readonly workspaceId: string;
  readonly sessionId: string;
}

export type EndTerminalSession = (input: EndTerminalSessionInput) => void;

export interface RequestCloseTabInput {
  readonly layoutApi: WorkbenchLayoutApi;
  readonly panelId: string;
  readonly endTerminalSession: EndTerminalSession;
}

function assertNever(value: never): never {
  throw new Error(`Unhandled workbench tab kind: ${String(value)}`);
}

// A dirty buffer another workspace kept open for the same path must survive.
function findOwnFileBuffer(
  workspaceId: string,
  path: string,
): OpenFile | undefined {
  return useEditorStore
    .getState()
    .openFiles.find(
      (file) =>
        file.path === path &&
        resolveTabWorkspaceId(file, workspaceId) === workspaceId,
    );
}

// Returns false when the user chose to keep the tab.
function releaseTabResources(
  params: WorkbenchTabParams,
  endTerminalSession: EndTerminalSession,
): boolean {
  switch (params.kind) {
    case "file": {
      const fileBuffer = findOwnFileBuffer(params.workspaceId, params.path);
      if (!fileBuffer) return true;
      const isDiscardConfirmed =
        !fileBuffer.isDirty ||
        window.confirm(
          `${fileBuffer.name} has unsaved changes. Close and discard them?`,
        );
      if (!isDiscardConfirmed) return false;
      useEditorStore.getState().closeFile(params.path);
      return true;
    }
    case "terminal":
      endTerminalSession({
        workspaceId: params.workspaceId,
        sessionId: params.sessionId,
      });
      return true;
    case "chat":
    case "diff":
    case "launcher":
      return true;
    default:
      return assertNever(params);
  }
}

export function requestCloseTab(input: RequestCloseTabInput): boolean {
  const { layoutApi, panelId, endTerminalSession } = input;
  const panel = layoutApi.getPanel(panelId);
  if (!panel) return false;
  if (!releaseTabResources(panel.params, endTerminalSession)) return false;
  layoutApi.removePanel(panelId);
  useWorkbenchStore.getState().forgetPanel(panel.params.workspaceId, panelId);
  return true;
}

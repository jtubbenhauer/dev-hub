import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DockviewReact, type DockviewApi } from "dockview-react";
import { vi, type MockInstance } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import { FileTabPanel } from "@/components/workbench/tabs/file-tab-panel";
import { SETTINGS_KEYS, type EditorType } from "@/hooks/use-settings";
import type { WorkbenchTabParams } from "@/lib/workbench/tab-descriptors";
import { useWorkbenchStore } from "@/stores/workbench-store";
import type { GitFileStatus, GitStatusResult, OpenFile } from "@/types";

export const WORKSPACE_ID = "ws1";

export interface FileTabSpec {
  readonly panelId: string;
  readonly path: string;
  readonly workspaceId?: string;
  // Opens the tab in its own group to the right of the previous tab.
  readonly isBeside?: boolean;
}

export interface FileTabSettings {
  readonly editorType?: EditorType;
  readonly isLspEnabled?: boolean;
}

export function fileTabParams(
  path: string,
  workspaceId = WORKSPACE_ID,
): WorkbenchTabParams {
  return { kind: "file", workspaceId, path };
}

export function createFileBuffer(
  path: string,
  overrides: Partial<OpenFile> = {},
): OpenFile {
  return {
    workspaceId: WORKSPACE_ID,
    instanceId: 1,
    path,
    name: path.split("/").pop() ?? path,
    content: "content",
    originalContent: "content",
    language: "typescript",
    isDirty: false,
    ...overrides,
  };
}

function changedFile(path: string): GitFileStatus {
  return { path, index: " ", workingDir: "M" };
}

export function createGitStatus(
  changes: {
    readonly unstaged?: readonly string[];
    readonly staged?: readonly string[];
    readonly isRepo?: boolean;
  } = {},
): GitStatusResult {
  return {
    isRepo: changes.isRepo ?? true,
    branch: "main",
    tracking: null,
    ahead: 0,
    behind: 0,
    staged: (changes.staged ?? []).map(changedFile),
    unstaged: (changes.unstaged ?? []).map(changedFile),
    untracked: [],
    conflicted: [],
    lastCommit: null,
  };
}

// A real dockview with file tabs; focus is recorded like WorkbenchDockview does.
export function renderFileTabs(
  specs: readonly FileTabSpec[],
  settings: FileTabSettings = {},
) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
  queryClient.setQueryData(["settings"], {
    [SETTINGS_KEYS.EDITOR_TYPE]: settings.editorType ?? "monaco",
    [SETTINGS_KEYS.LSP_ENABLED]: settings.isLspEnabled ?? false,
  });
  const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
  const setActiveSpies = new Map<string, MockInstance>();
  const readyApis: DockviewApi[] = [];
  render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <div style={{ width: 800, height: 600 }}>
          <DockviewReact
            components={{ file: FileTabPanel }}
            defaultRenderer="always"
            onReady={(event) => {
              event.api.onDidActivePanelChange(({ panel }) => {
                const params: unknown = panel?.params;
                if (!panel || typeof params !== "object" || params === null)
                  return;
                const spec = specs.find((item) => item.panelId === panel.id);
                if (!spec) return;
                useWorkbenchStore.getState().setFocusedPanel({
                  workspaceId: spec.workspaceId ?? WORKSPACE_ID,
                  panelId: spec.panelId,
                  params: fileTabParams(spec.path, spec.workspaceId),
                });
              });
              let previousPanelId: string | null = null;
              for (const spec of specs) {
                const panel = event.api.addPanel({
                  id: spec.panelId,
                  component: "file",
                  params: fileTabParams(spec.path, spec.workspaceId),
                  title: spec.path,
                  ...(spec.isBeside && previousPanelId !== null
                    ? {
                        position: {
                          referencePanel: previousPanelId,
                          direction: "right" as const,
                        },
                      }
                    : {}),
                });
                setActiveSpies.set(
                  spec.panelId,
                  vi.spyOn(panel.api, "setActive"),
                );
                previousPanelId = spec.panelId;
              }
              readyApis.push(event.api);
            }}
          />
        </div>
      </TooltipProvider>
    </QueryClientProvider>,
  );
  const [api] = readyApis;
  if (!api) throw new Error("DockviewReact never fired onReady");
  return { api, invalidateQueries, setActiveSpies };
}

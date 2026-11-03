"use client";

import "dockview-react/dist/styles/dockview.css";
import "./workbench-dockview.css";

import { useCallback, useEffect, useState } from "react";
import {
  DockviewReact,
  type DockviewApi,
  type DockviewReadyEvent,
} from "dockview-react";
import { createDockviewLayoutApi } from "@/components/workbench/dockview-layout-api";
import { DEVHUB_DOCKVIEW_THEME } from "@/components/workbench/dockview-theme";
import { WORKBENCH_PANEL_COMPONENTS } from "@/components/workbench/tab-registry";
import { createWorkbenchDockviewController } from "@/components/workbench/workbench-dockview-controller";
import { restoreWorkbenchDockview } from "@/components/workbench/workbench-dockview-restore";
import { WorkbenchGroupActions } from "@/components/workbench/workbench-group-actions";
import { LauncherWatermark } from "@/components/workbench/workbench-launcher";
import { WorkbenchModeProvider } from "@/components/workbench/workbench-mode-context";
import { WorkbenchTabHeader } from "@/components/workbench/workbench-tab-header";
import { useEndTerminalSession } from "@/hooks/use-terminal-sessions";
import { registerWorkbenchController } from "@/lib/workbench/workbench-controller-registry";
import { useEditorStore } from "@/stores/editor-store";
import { layoutStorageKey, useWorkbenchStore } from "@/stores/workbench-store";

const LAYOUT_SAVE_DEBOUNCE_MS = 300;

interface WorkbenchDockviewProps {
  readonly workspaceId: string;
  readonly isMobile: boolean;
}

export function WorkbenchDockview({
  workspaceId,
  isMobile,
}: WorkbenchDockviewProps) {
  const [api, setApi] = useState<DockviewApi | null>(null);
  const { mutate: endTerminalSession } = useEndTerminalSession();

  // dockview keeps its instance across StrictMode effect replays and calls
  // onReady once, so this only restores; every subscription lives in the effect.
  const handleReady = useCallback(
    (event: DockviewReadyEvent) => {
      restoreWorkbenchDockview({ api: event.api, workspaceId, isMobile });
      setApi(event.api);
    },
    [workspaceId, isMobile],
  );

  useEffect(() => {
    if (!api) return;
    const layoutApi = createDockviewLayoutApi(api);
    // Mobile has its own key so a phone never overwrites the desktop layout.
    const layoutKey = layoutStorageKey(workspaceId, isMobile);
    const saveLayoutNow = () =>
      useWorkbenchStore.getState().saveLayout(layoutKey, api.toJSON());

    const unregisterController = registerWorkbenchController(
      createWorkbenchDockviewController({
        layoutApi,
        workspaceId,
        endTerminalSession,
      }),
    );

    let pendingSaveTimer: ReturnType<typeof setTimeout> | null = null;
    const layoutSubscription = api.onDidLayoutChange(() => {
      if (pendingSaveTimer !== null) clearTimeout(pendingSaveTimer);
      pendingSaveTimer = setTimeout(() => {
        pendingSaveTimer = null;
        saveLayoutNow();
      }, LAYOUT_SAVE_DEBOUNCE_MS);
    });

    // Replays the current active panel on subscribe, so restore-time focus is seen.
    const activePanelSubscription = api.onDidActivePanelChange(({ panel }) => {
      const panelRef = panel ? layoutApi.getPanel(panel.id) : null;
      const { setFocusedPanel } = useWorkbenchStore.getState();
      if (!panelRef) {
        setFocusedPanel(null);
        return;
      }
      setFocusedPanel({
        workspaceId,
        panelId: panelRef.id,
        params: panelRef.params,
      });
      if (panelRef.params.kind === "file") {
        useEditorStore.getState().setActiveFile(panelRef.params.path);
      }
    });

    useWorkbenchStore.getState().setLayoutReadyWorkspaceId(workspaceId);

    // Runs before DockviewReact disposes the instance (parent cleanups run first).
    return () => {
      if (pendingSaveTimer !== null) clearTimeout(pendingSaveTimer);
      saveLayoutNow();
      layoutSubscription.dispose();
      activePanelSubscription.dispose();
      unregisterController();
      useWorkbenchStore.getState().setFocusedPanel(null);
      useWorkbenchStore.getState().setLayoutReadyWorkspaceId(null);
    };
  }, [api, workspaceId, isMobile, endTerminalSession]);

  return (
    <WorkbenchModeProvider isMobile={isMobile}>
      <div className="h-full w-full">
        <DockviewReact
          theme={DEVHUB_DOCKVIEW_THEME}
          components={WORKBENCH_PANEL_COMPONENTS}
          defaultTabComponent={WorkbenchTabHeader}
          watermarkComponent={LauncherWatermark}
          rightHeaderActionsComponent={WorkbenchGroupActions}
          disableFloatingGroups
          disableDnd={isMobile}
          defaultRenderer="always"
          onReady={handleReady}
        />
      </div>
    </WorkbenchModeProvider>
  );
}

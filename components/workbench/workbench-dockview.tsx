"use client";

import "dockview-react/dist/styles/dockview.css";
import "./workbench-dockview.css";

import { useCallback, useEffect, useState } from "react";
import {
  DockviewReact,
  type DockviewApi,
  type DockviewReadyEvent,
} from "dockview-react";
import {
  startChatTargetSync,
  syncGlobalChatSessionToTab,
} from "@/components/workbench/chat-target-sync";
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
        isMobile,
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

    // A tab click in an inactive group first activates the group — firing this
    // event with the group's PREVIOUS panel — and activates the clicked panel
    // only afterwards (one animation frame later with dockview's html5 dnd
    // backend, see Tab._activateOnPointerDown). One pending frame coalesces the
    // burst so only the panel still active at its end is recorded; a transient
    // panel never rewrites lastFocused or the global chat session. The event
    // replays on subscribe, so restore-time focus is still seen.
    let isDockviewDisposed = false;
    let isFocusFrameScheduled = false;
    let focusFrameHandle = 0;
    const recordActivePanel = () => {
      isFocusFrameScheduled = false;
      if (isDockviewDisposed) return;
      const activePanelId = layoutApi.getActivePanelId();
      const panelRef =
        activePanelId === null ? null : layoutApi.getPanel(activePanelId);
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
      if (panelRef.params.kind === "chat") {
        syncGlobalChatSessionToTab(workspaceId, panelRef.params.sessionId);
      }
    };
    const activePanelSubscription = api.onDidActivePanelChange(() => {
      if (isFocusFrameScheduled) return;
      isFocusFrameScheduled = true;
      focusFrameHandle = requestAnimationFrame(recordActivePanel);
    });

    useWorkbenchStore.getState().setLayoutReadyWorkspaceId(workspaceId);
    const stopChatTargetSync = startChatTargetSync({ layoutApi, workspaceId });

    // Runs before DockviewReact disposes the instance (parent cleanups run first).
    return () => {
      if (pendingSaveTimer !== null) clearTimeout(pendingSaveTimer);
      saveLayoutNow();
      layoutSubscription.dispose();
      activePanelSubscription.dispose();
      isDockviewDisposed = true;
      if (isFocusFrameScheduled) cancelAnimationFrame(focusFrameHandle);
      stopChatTargetSync();
      unregisterController();
      useWorkbenchStore.getState().setFocusedPanel(null);
      useWorkbenchStore.getState().setLayoutReadyWorkspaceId(null);
    };
  }, [api, workspaceId, isMobile, endTerminalSession]);

  // `isolate` keeps dockview's z-index 99 sashes under app overlays (drawer).
  // `overflow-clip` keeps never-laid-out hidden tab overlays from making the
  // page scrollable, so Monaco's scrollIntoView cannot shift the workbench.
  return (
    <WorkbenchModeProvider isMobile={isMobile}>
      <div className="isolate h-full w-full overflow-clip">
        <DockviewReact
          theme={DEVHUB_DOCKVIEW_THEME}
          components={WORKBENCH_PANEL_COMPONENTS}
          defaultTabComponent={WorkbenchTabHeader}
          watermarkComponent={LauncherWatermark}
          rightHeaderActionsComponent={WorkbenchGroupActions}
          disableFloatingGroups
          disableDnd={isMobile}
          // A phone strip fits about one tab, so dockview's list of clipped tabs
          // named tabs already on screen; the group actions list every tab
          // instead. Native scrolling lets dockview scroll the active tab into
          // view (its custom scrollbar overwrites that scroll).
          disableTabsOverflowList={isMobile}
          scrollbars={isMobile ? "native" : "custom"}
          defaultRenderer="always"
          onReady={handleReady}
        />
      </div>
    </WorkbenchModeProvider>
  );
}

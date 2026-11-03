import { useCallback, useSyncExternalStore } from "react";
import type { DockviewApi, DockviewPanelApi } from "dockview-react";

export interface WorkbenchPanelState {
  // The panel is its group's shown tab (it may sit in an unfocused group).
  readonly isVisible: boolean;
  // The panel is the active panel of the active group.
  readonly isFocused: boolean;
}

export function useWorkbenchPanelState(
  api: DockviewPanelApi,
  containerApi: DockviewApi,
): WorkbenchPanelState {
  const subscribeToVisibility = useCallback(
    (onChange: () => void) => {
      const subscription = api.onDidVisibilityChange(onChange);
      return () => subscription.dispose();
    },
    [api],
  );
  const subscribeToActivePanel = useCallback(
    (onChange: () => void) => {
      const subscription = containerApi.onDidActivePanelChange(onChange);
      return () => subscription.dispose();
    },
    [containerApi],
  );
  const isVisible = useSyncExternalStore(
    subscribeToVisibility,
    () => api.isVisible,
  );
  const isFocused = useSyncExternalStore(
    subscribeToActivePanel,
    () => containerApi.activePanel?.id === api.id,
  );
  return { isVisible, isFocused };
}

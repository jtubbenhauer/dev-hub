import type { ReactNode } from "react";
import type { DockviewPanelApi } from "dockview-react";
import {
  useWorkbenchPanelFocusRequest,
  WorkbenchPanelFocusTargetContext,
} from "@/components/workbench/workbench-panel-focus";

interface WorkbenchPanelFrameProps {
  readonly api: DockviewPanelApi;
  readonly children: ReactNode;
}

// Capture phase: the panel becomes active before any inner click handler runs.
export function WorkbenchPanelFrame({
  api,
  children,
}: WorkbenchPanelFrameProps) {
  const { frameRef, registerFocusTarget } = useWorkbenchPanelFocusRequest(
    api.id,
  );
  return (
    <WorkbenchPanelFocusTargetContext.Provider value={registerFocusTarget}>
      <div
        ref={frameRef}
        tabIndex={-1}
        className="h-full min-h-0 outline-none"
        onPointerDownCapture={() => {
          if (!api.isActive) api.setActive();
        }}
      >
        {children}
      </div>
    </WorkbenchPanelFocusTargetContext.Provider>
  );
}

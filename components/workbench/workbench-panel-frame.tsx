import type { ReactNode } from "react";
import type { DockviewPanelApi } from "dockview-react";

interface WorkbenchPanelFrameProps {
  readonly api: DockviewPanelApi;
  readonly children: ReactNode;
}

// Capture phase: the panel becomes active before any inner click handler runs.
export function WorkbenchPanelFrame({
  api,
  children,
}: WorkbenchPanelFrameProps) {
  return (
    <div
      className="h-full min-h-0"
      onPointerDownCapture={() => {
        if (!api.isActive) api.setActive();
      }}
    >
      {children}
    </div>
  );
}

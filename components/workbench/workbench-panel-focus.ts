import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
} from "react";
import { useWorkbenchStore } from "@/stores/workbench-store";

export type WorkbenchPanelFocusTarget = () => void;

type RegisterFocusTarget = (target: WorkbenchPanelFocusTarget) => () => void;

export const WorkbenchPanelFocusTargetContext =
  createContext<RegisterFocusTarget | null>(null);

// A tab body names what takes the keyboard focus (terminal, editor, composer).
export function useWorkbenchPanelFocusTarget(
  focusTarget: WorkbenchPanelFocusTarget,
): void {
  const registerFocusTarget = useContext(WorkbenchPanelFocusTargetContext);
  useEffect(
    () => registerFocusTarget?.(focusTarget),
    [registerFocusTarget, focusTarget],
  );
}

// dockview moves the active tab but never the DOM focus: a keyboard command
// asks the tab's frame to move it, into the body's target or else the frame.
export function useWorkbenchPanelFocusRequest(panelId: string) {
  const frameRef = useRef<HTMLDivElement>(null);
  const focusTargetRef = useRef<WorkbenchPanelFocusTarget | null>(null);
  const isFocusRequested = useWorkbenchStore(
    (state) => state.panelFocusRequest === panelId,
  );

  const registerFocusTarget = useCallback(
    (focusTarget: WorkbenchPanelFocusTarget) => {
      focusTargetRef.current = focusTarget;
      return () => {
        if (focusTargetRef.current === focusTarget) {
          focusTargetRef.current = null;
        }
      };
    },
    [],
  );

  useEffect(() => {
    if (!isFocusRequested) return;
    // Next frame: dockview reveals a re-shown tab's overlay in a frame of its own.
    const frame = requestAnimationFrame(() => {
      if (!useWorkbenchStore.getState().takePanelFocusRequest(panelId)) return;
      focusTargetRef.current?.();
      const frameElement = frameRef.current;
      if (frameElement && !frameElement.contains(document.activeElement)) {
        frameElement.focus({ preventScroll: true });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [isFocusRequested, panelId]);

  return { frameRef, registerFocusTarget };
}

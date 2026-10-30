import { useCallback, useState, type PointerEvent } from "react";
import { useTerminalStore } from "@/stores/terminal-store";

const HEADER_HEIGHT_PX = 48;

export function useDrawerResize() {
  const [isResizing, setIsResizing] = useState(false);

  const handleResizePointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      const handle = event.currentTarget;
      handle.setPointerCapture(event.pointerId);
      setIsResizing(true);

      const handleMove = (moveEvent: globalThis.PointerEvent) => {
        const maxHeight = window.innerHeight - HEADER_HEIGHT_PX;
        const nextHeight = Math.min(
          window.innerHeight - moveEvent.clientY,
          maxHeight,
        );
        useTerminalStore.getState().setDrawerHeightPx(nextHeight);
      };
      const handleUp = () => {
        setIsResizing(false);
        handle.removeEventListener("pointermove", handleMove);
        handle.removeEventListener("pointerup", handleUp);
        handle.removeEventListener("pointercancel", handleUp);
      };
      handle.addEventListener("pointermove", handleMove);
      handle.addEventListener("pointerup", handleUp);
      handle.addEventListener("pointercancel", handleUp);
    },
    [],
  );

  return { isResizing, handleResizePointerDown };
}

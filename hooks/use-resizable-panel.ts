import { useState, useRef, useCallback } from "react";

interface UseResizablePanelOptions {
  minWidth: number;
  maxWidth: number;
  defaultWidth: number;
  storageKey?: string;
  reverse?: boolean;
}

interface UseResizablePanelResult {
  width: number;
  handleDragStart: (e: React.MouseEvent) => void;
}

function readStoredWidth(
  storageKey: string,
  defaultWidth: number,
  minWidth: number,
  maxWidth: number,
): number {
  try {
    const stored = localStorage.getItem(storageKey);
    if (stored === null) return defaultWidth;
    const parsed = parseInt(stored, 10);
    if (isNaN(parsed)) return defaultWidth;
    return Math.max(minWidth, Math.min(maxWidth, parsed));
  } catch {
    return defaultWidth;
  }
}

export function useResizablePanel({
  minWidth,
  maxWidth,
  defaultWidth,
  storageKey,
  reverse,
}: UseResizablePanelOptions): UseResizablePanelResult {
  const [width, setWidth] = useState<number>(() => {
    if (storageKey)
      return readStoredWidth(storageKey, defaultWidth, minWidth, maxWidth);
    return defaultWidth;
  });

  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(0);
  // Track current width during drag so handleDragEnd can persist it
  const currentWidthRef = useRef(width);

  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isDragging.current = true;
      dragStartX.current = e.clientX;
      dragStartWidth.current = currentWidthRef.current;

      const handleDragMove = (me: MouseEvent) => {
        if (!isDragging.current) return;
        const delta = (me.clientX - dragStartX.current) * (reverse ? -1 : 1);
        const newWidth = Math.max(
          minWidth,
          Math.min(maxWidth, dragStartWidth.current + delta),
        );
        currentWidthRef.current = newWidth;
        setWidth(newWidth);
      };

      const handleDragEnd = () => {
        if (!isDragging.current) return;
        isDragging.current = false;
        document.removeEventListener("mousemove", handleDragMove);
        document.removeEventListener("mouseup", handleDragEnd);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";

        if (storageKey) {
          try {
            localStorage.setItem(storageKey, String(currentWidthRef.current));
          } catch {
            // localStorage unavailable — silently skip persistence
          }
        }
      };

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", handleDragMove);
      document.addEventListener("mouseup", handleDragEnd);
    },
    [minWidth, maxWidth, storageKey, reverse],
  );

  return { width, handleDragStart };
}

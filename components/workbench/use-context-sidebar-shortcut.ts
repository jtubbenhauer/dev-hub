import { useEffect } from "react";
import { matchWorkbenchChord } from "@/lib/workbench/workbench-shortcuts";
import { useContextSidebarStore } from "@/stores/context-sidebar-store";

interface UseContextSidebarShortcutInput {
  readonly isMobile: boolean;
}

// Capture phase, so a focused terminal or editor cannot swallow Cmd/Ctrl+\.
export function useContextSidebarShortcut({
  isMobile,
}: UseContextSidebarShortcutInput): void {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (matchWorkbenchChord(event)?.type !== "toggle-context-sidebar") return;
      event.preventDefault();
      const contextSidebar = useContextSidebarStore.getState();
      if (isMobile) {
        contextSidebar.setMobileSheetOpen(!contextSidebar.isMobileSheetOpen);
        return;
      }
      contextSidebar.toggle();
    };
    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () =>
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [isMobile]);
}

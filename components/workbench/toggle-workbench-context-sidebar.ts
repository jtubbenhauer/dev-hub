import { isMobileViewport } from "@/hooks/use-is-mobile-resolved";
import { useContextSidebarStore } from "@/stores/context-sidebar-store";

// A phone shows the sidebar as a sheet, so the toggle drives the sheet there.
export function toggleWorkbenchContextSidebar(): void {
  const contextSidebar = useContextSidebarStore.getState();
  if (isMobileViewport()) {
    contextSidebar.setMobileSheetOpen(!contextSidebar.isMobileSheetOpen);
    return;
  }
  contextSidebar.toggle();
}

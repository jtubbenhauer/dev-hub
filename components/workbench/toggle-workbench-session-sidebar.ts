import { isMobileViewport } from "@/hooks/use-is-mobile-resolved";
import { useSessionSidebarStore } from "@/stores/session-sidebar-store";

// A phone shows the session list as a sheet, so the toggle drives the sheet.
export function toggleWorkbenchSessionSidebar(): void {
  const sessionSidebar = useSessionSidebarStore.getState();
  if (isMobileViewport()) {
    sessionSidebar.setMobileSheetOpen(!sessionSidebar.isMobileSheetOpen);
    return;
  }
  sessionSidebar.toggle();
}

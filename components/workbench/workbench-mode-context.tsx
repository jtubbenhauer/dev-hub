import { createContext, useContext, type ReactNode } from "react";

// dockview renders tabs and header actions through portals under DockviewReact,
// so this context reaches them.
const WorkbenchMobileContext = createContext(false);

interface WorkbenchModeProviderProps {
  readonly isMobile: boolean;
  readonly children: ReactNode;
}

export function WorkbenchModeProvider({
  isMobile,
  children,
}: WorkbenchModeProviderProps) {
  return (
    <WorkbenchMobileContext.Provider value={isMobile}>
      {children}
    </WorkbenchMobileContext.Provider>
  );
}

export function useIsWorkbenchMobile(): boolean {
  return useContext(WorkbenchMobileContext);
}

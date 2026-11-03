import { useEffect, useState } from "react";
import { MOBILE_BREAKPOINT } from "@/hooks/use-mobile";

// Same breakpoint as useIsMobile, but null until the first effect has measured
// the window, so a caller can wait instead of rendering the desktop layout first.
export function useIsMobileResolved(): boolean | null {
  const [isMobile, setIsMobile] = useState<boolean | null>(null);

  useEffect(() => {
    const updateIsMobile = () =>
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    updateIsMobile();
    // jsdom has no matchMedia; the width read above still resolves the hook.
    if (!window.matchMedia) return;
    const mediaQueryList = window.matchMedia(
      `(max-width: ${MOBILE_BREAKPOINT - 1}px)`,
    );
    mediaQueryList.addEventListener("change", updateIsMobile);
    return () => mediaQueryList.removeEventListener("change", updateIsMobile);
  }, []);

  return isMobile;
}

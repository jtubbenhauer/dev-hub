"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { openFindInFiles } from "@/lib/files/open-find-in-files";
import { getIsMac } from "@/lib/utils";

// Cmd+Shift+F (Ctrl+Shift+F elsewhere) opens find in files. The capture-phase
// listener runs before editors or inputs that stop keydown propagation.
export function FindInFilesShortcut() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const isMac = getIsMac();
    function handleKeyDown(e: KeyboardEvent) {
      const hasShortcutModifiers = isMac
        ? e.metaKey && e.shiftKey && !e.ctrlKey && !e.altKey
        : e.ctrlKey && e.shiftKey && !e.metaKey && !e.altKey;
      if (!hasShortcutModifiers || e.key.toLowerCase() !== "f") return;
      e.preventDefault();
      e.stopPropagation();
      openFindInFiles({ pathname, push: (href) => router.push(href) });
    }

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () =>
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [pathname, router]);

  return null;
}

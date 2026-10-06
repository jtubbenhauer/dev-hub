import { useEffect, useRef } from "react";
import { registerLspOpenFileHandler } from "@/lib/lsp/client/navigation-registry";
import type { LspSurface } from "@/lib/lsp/types";

export function useLspOpenFileHandler(
  surface: LspSurface,
  open: (relativePath: string, shouldCommit: () => boolean) => Promise<boolean>,
  getActivePath: () => string | null,
): void {
  const openRef = useRef(open);
  const getActivePathRef = useRef(getActivePath);

  useEffect(() => {
    openRef.current = open;
    getActivePathRef.current = getActivePath;
  }, [open, getActivePath]);

  useEffect(
    () =>
      registerLspOpenFileHandler(
        surface,
        async (relativePath, isCurrent) =>
          (await openRef.current(relativePath, isCurrent)) &&
          isCurrent() &&
          getActivePathRef.current() === relativePath,
      ),
    [surface],
  );
}

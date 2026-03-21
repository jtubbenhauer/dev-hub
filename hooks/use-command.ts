import { useEffect } from "react";
import {
  useCommandPalette,
  type PaletteCommand,
} from "@/components/providers/command-palette-provider";

/**
 * Register scoped commands into the command palette.
 * Commands are automatically removed when the component unmounts.
 *
 * Pass a stable array (defined outside render or memoized) to avoid
 * re-registering on every render.
 */
export function useCommand(commands: PaletteCommand[]) {
  const { registerCommands } = useCommandPalette();

  useEffect(() => {
    const deregister = registerCommands(commands);
    return deregister;
    // Intentionally omit `commands` from deps — callers must pass a stable ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registerCommands]);
}

"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type { LucideIcon } from "lucide-react";
import { getIsMac } from "@/lib/utils";

export interface PaletteCommand {
  id: string;
  label: string;
  group: string;
  icon?: LucideIcon | React.ComponentType<{ className?: string }>;
  shortcut?: string;
  // Muted text after the label, e.g. the shell command a quick command runs.
  detail?: string;
  // Other names to find it by, as whole phrases ("add worktree", not "add"):
  // the fuzzy search matches the typed letters in order.
  keywords?: string[];
  onSelect: () => void;
}

interface CommandPaletteContextValue {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
  registerCommands: (commands: PaletteCommand[]) => () => void;
  commands: PaletteCommand[];
}

const CommandPaletteContext = createContext<CommandPaletteContextValue | null>(
  null,
);

export function useCommandPalette() {
  const context = useContext(CommandPaletteContext);
  if (!context)
    throw new Error(
      "useCommandPalette must be used within CommandPaletteProvider",
    );
  return context;
}

// Cmd+Shift+P (Ctrl+Shift+P elsewhere), as in VS Code, or the older Ctrl+,.
// Cmd held makes macOS report the letter in lowercase.
function isCommandPaletteShortcut(e: KeyboardEvent, isMac: boolean): boolean {
  const hasPrimaryShift = isMac
    ? e.metaKey && e.shiftKey && !e.ctrlKey && !e.altKey
    : e.ctrlKey && e.shiftKey && !e.metaKey && !e.altKey;
  if (hasPrimaryShift && e.key.toLowerCase() === "p") return true;
  return e.key === "," && e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey;
}

export function CommandPaletteProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(false);
  // Use a ref-based registry so registration/deregistration doesn't cause re-renders
  const registryRef = useRef<Map<string, PaletteCommand>>(new Map());
  const [commands, setCommands] = useState<PaletteCommand[]>([]);

  const syncCommands = useCallback(() => {
    setCommands(Array.from(registryRef.current.values()));
  }, []);

  const registerCommands = useCallback(
    (incoming: PaletteCommand[]) => {
      for (const cmd of incoming) {
        registryRef.current.set(cmd.id, cmd);
      }
      syncCommands();

      return () => {
        for (const cmd of incoming) {
          registryRef.current.delete(cmd.id);
        }
        syncCommands();
      };
    },
    [syncCommands],
  );

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const toggle = useCallback(() => setIsOpen((prev) => !prev), []);

  // Capture phase, so editors and terminals that stop keydown never see it.
  useEffect(() => {
    const isMac = getIsMac();
    function handleKeyDown(e: KeyboardEvent) {
      if (!isCommandPaletteShortcut(e, isMac)) return;
      e.preventDefault();
      e.stopPropagation();
      // A held shortcut would flicker the palette open and shut.
      if (!e.repeat) toggle();
    }

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () =>
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [toggle]);

  return (
    <CommandPaletteContext.Provider
      value={{ isOpen, open, close, toggle, registerCommands, commands }}
    >
      {children}
    </CommandPaletteContext.Provider>
  );
}

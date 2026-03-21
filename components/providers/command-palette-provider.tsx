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

export interface PaletteCommand {
  id: string;
  label: string;
  group: string;
  icon?: LucideIcon | React.ComponentType<{ className?: string }>;
  shortcut?: string;
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

  // Global Ctrl+, trigger
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (
        e.key === "," &&
        e.ctrlKey &&
        !e.shiftKey &&
        !e.altKey &&
        !e.metaKey
      ) {
        e.preventDefault();
        toggle();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toggle]);

  return (
    <CommandPaletteContext.Provider
      value={{ isOpen, open, close, toggle, registerCommands, commands }}
    >
      {children}
    </CommandPaletteContext.Provider>
  );
}

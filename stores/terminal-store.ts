import { create } from "zustand";
import { persist } from "zustand/middleware";

interface TerminalState {
  isOpen: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
}

export const useTerminalStore = create<TerminalState>()(
  persist(
    (set) => ({
      isOpen: false,
      setOpen: (open) => set({ isOpen: open }),
      toggle: () => set((s) => ({ isOpen: !s.isOpen })),
    }),
    { name: "dev-hub-terminal" },
  ),
);

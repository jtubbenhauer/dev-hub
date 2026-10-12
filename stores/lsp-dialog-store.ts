import { create } from "zustand";

interface LspDialogState {
  readonly request: { resolve(path: string | null): void } | null;
  open(): Promise<string | null>;
  close(path: string | null): void;
}

export const useLspDialogStore = create<LspDialogState>()((set, get) => ({
  request: null,
  open: () =>
    new Promise((resolve) => {
      get().request?.resolve(null);
      set({ request: { resolve } });
    }),
  close: (path) => {
    const request = get().request;
    set({ request: null });
    request?.resolve(path);
  },
}));

import { create } from "zustand";
import type { LspClientStatus } from "@/lib/lsp/types";

interface LspState {
  status: LspClientStatus;
  errorMessage: string | null;
  serverEpoch: number | null;
  sessionWorkspaceId: string | null;
  isMonacoRegistered: boolean;
  documentOwners: Record<string, string>;
  retryNonce: number;
  setStatus: (status: LspClientStatus, errorMessage?: string | null) => void;
  setSession: (workspaceId: string | null, epoch: number | null) => void;
  markMonacoRegistered: () => void;
  claimDocument: (uriKey: string, ownerId: string) => boolean;
  releaseDocument: (uriKey: string, ownerId: string) => void;
  requestRetry: () => void;
}

export const useLspStore = create<LspState>()((set, get) => ({
  status: "disabled",
  errorMessage: null,
  serverEpoch: null,
  sessionWorkspaceId: null,
  isMonacoRegistered: false,
  documentOwners: {},
  retryNonce: 0,

  setStatus: (status, errorMessage) =>
    set({ status, errorMessage: errorMessage ?? null }),

  setSession: (workspaceId, epoch) =>
    set({ sessionWorkspaceId: workspaceId, serverEpoch: epoch }),

  markMonacoRegistered: () => set({ isMonacoRegistered: true }),

  claimDocument: (uriKey, ownerId) => {
    const currentOwner = get().documentOwners[uriKey];
    if (currentOwner !== undefined) return currentOwner === ownerId;
    set((state) => ({
      documentOwners: { ...state.documentOwners, [uriKey]: ownerId },
    }));
    return true;
  },

  releaseDocument: (uriKey, ownerId) => {
    if (get().documentOwners[uriKey] !== ownerId) return;
    set((state) => {
      const { [uriKey]: _released, ...remainingOwners } = state.documentOwners;
      return { documentOwners: remainingOwners };
    });
  },

  requestRetry: () => set((state) => ({ retryNonce: state.retryNonce + 1 })),
}));

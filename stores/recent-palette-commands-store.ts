import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createUnchangedPersistStorage } from "@/components/editor/unchanged-persist-storage";

// The command palette pins these on top; a short list stays glanceable.
const MAX_RECENT_COMMANDS = 5;

interface PersistedRecentPaletteCommandsState {
  recentCommandIds: string[];
}

interface RecentPaletteCommandsState extends PersistedRecentPaletteCommandsState {
  recordCommand: (commandId: string) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseRecentCommandIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((commandId): commandId is string => typeof commandId === "string")
    .slice(0, MAX_RECENT_COMMANDS);
}

export const useRecentPaletteCommandsStore =
  create<RecentPaletteCommandsState>()(
    persist(
      (set) => ({
        recentCommandIds: [],

        recordCommand: (commandId) =>
          set((state) => ({
            recentCommandIds: [
              commandId,
              ...state.recentCommandIds.filter((id) => id !== commandId),
            ].slice(0, MAX_RECENT_COMMANDS),
          })),
      }),
      {
        name: "dev-hub:recent-palette-commands",
        version: 1,
        storage:
          createUnchangedPersistStorage<PersistedRecentPaletteCommandsState>(),
        partialize: (state): PersistedRecentPaletteCommandsState => ({
          recentCommandIds: state.recentCommandIds,
        }),
        merge: (persisted, current) => ({
          ...current,
          recentCommandIds: parseRecentCommandIds(
            isRecord(persisted) ? persisted.recentCommandIds : undefined,
          ),
        }),
      },
    ),
  );

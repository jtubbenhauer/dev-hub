import { create } from "zustand";
import { persist } from "zustand/middleware";

import {
  isOmoPermissionPreset,
  type OmoPermissionPreset,
} from "@/lib/omo/permission-presets";

interface OmoPermissionPresetState {
  presetByWorkspace: Record<string, OmoPermissionPreset>;
  setPreset: (workspaceId: string, preset: OmoPermissionPreset) => void;
}

function validPresets(value: unknown): Record<string, OmoPermissionPreset> {
  if (typeof value !== "object" || value === null) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, OmoPermissionPreset] =>
        isOmoPermissionPreset(entry[1]),
    ),
  );
}

export const useOmoPermissionPresetStore = create<OmoPermissionPresetState>()(
  persist(
    (set) => ({
      presetByWorkspace: {},
      setPreset: (workspaceId, preset) =>
        set((state) => ({
          presetByWorkspace: {
            ...state.presetByWorkspace,
            [workspaceId]: preset,
          },
        })),
    }),
    {
      name: "dev-hub:omo-permission-presets",
      partialize: (state) => ({ presetByWorkspace: state.presetByWorkspace }),
      merge: (persisted, current) => ({
        ...current,
        presetByWorkspace: validPresets(
          typeof persisted === "object" && persisted !== null
            ? (persisted as Record<string, unknown>)["presetByWorkspace"]
            : undefined,
        ),
      }),
    },
  ),
);

export function getOmoPermissionPreset(
  workspaceId: string,
): OmoPermissionPreset | undefined {
  return useOmoPermissionPresetStore.getState().presetByWorkspace[workspaceId];
}

function errorMessage(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const error = (body as Record<string, unknown>)["error"];
  return typeof error === "string" ? error : undefined;
}

export async function applyOmoPermissionPreset(
  workspaceId: string,
  sessionId: string,
  preset: OmoPermissionPreset,
): Promise<void> {
  const response = await fetch(
    `/api/opencode/session/${encodeURIComponent(sessionId)}/permission_preset?workspaceId=${encodeURIComponent(workspaceId)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ preset }),
    },
  );
  if (response.ok) return;
  const body: unknown = await response.json().catch(() => null);
  throw new Error(
    errorMessage(body) ??
      `Couldn't change permissions for this session (${response.status}).`,
  );
}

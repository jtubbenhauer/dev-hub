import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { SerializedDockview } from "dockview-react";
import { createUnchangedPersistStorage } from "@/components/editor/unchanged-persist-storage";
import {
  isWorkbenchTabParams,
  type WorkbenchTabKind,
  type WorkbenchTabParams,
} from "@/lib/workbench/tab-descriptors";

const MOBILE_LAYOUT_KEY_SUFFIX = "::mobile";

export interface LastFocusedPanel {
  panelId: string;
  params: WorkbenchTabParams;
}

export type LastFocusedPanelsByKind = Partial<
  Record<WorkbenchTabKind, LastFocusedPanel>
>;

export interface FocusedWorkbenchPanel {
  workspaceId: string;
  panelId: string;
  params: WorkbenchTabParams;
}

export interface PendingChatTarget {
  workspaceId: string;
  sessionId: string;
  panelId: string | null;
  // A retarget normally keeps the panel in the background (createSession in a
  // background tab must not steal focus); a session-list pick asks to activate.
  shouldActivate?: boolean;
}

interface PersistedWorkbenchState {
  layoutsByKey: Record<string, SerializedDockview>;
  lastFocusedPanelByWorkspace: Record<string, LastFocusedPanelsByKind>;
}

interface WorkbenchState extends PersistedWorkbenchState {
  focusedPanel: FocusedWorkbenchPanel | null;
  layoutReadyWorkspaceId: string | null;
  pendingChatTarget: PendingChatTarget | null;
  // The tab whose content should take the DOM focus after a keyboard command.
  panelFocusRequest: string | null;

  saveLayout: (key: string, layout: SerializedDockview) => void;
  getLayout: (key: string) => SerializedDockview | null;
  setFocusedPanel: (value: FocusedWorkbenchPanel | null) => void;
  updateLastFocusedParams: (
    workspaceId: string,
    panelId: string,
    params: WorkbenchTabParams,
  ) => void;
  forgetPanel: (workspaceId: string, panelId: string) => void;
  setLayoutReadyWorkspaceId: (workspaceId: string | null) => void;
  requestChatTarget: (target: PendingChatTarget) => void;
  takePendingChatTarget: (workspaceId: string) => PendingChatTarget | null;
  requestPanelFocus: (panelId: string) => void;
  takePanelFocusRequest: (panelId: string) => boolean;
  pruneWorkspaces: (knownWorkspaceIds: readonly string[]) => void;
}

export function layoutStorageKey(
  workspaceId: string,
  isMobile: boolean,
): string {
  return isMobile ? `${workspaceId}${MOBILE_LAYOUT_KEY_SUFFIX}` : workspaceId;
}

function workspaceIdFromLayoutKey(key: string): string {
  return key.endsWith(MOBILE_LAYOUT_KEY_SUFFIX)
    ? key.slice(0, -MOBILE_LAYOUT_KEY_SUFFIX.length)
    : key;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Shallow shape check only; dockview's fromJSON still validates the tree.
function isSerializedDockview(value: unknown): value is SerializedDockview {
  return (
    isRecord(value) &&
    isRecord(value.grid) &&
    isRecord(value.grid.root) &&
    isRecord(value.panels)
  );
}

function sanitizeLayouts(value: unknown): Record<string, SerializedDockview> {
  if (!isRecord(value)) return {};
  const layouts: Record<string, SerializedDockview> = {};
  for (const [key, layout] of Object.entries(value)) {
    if (isSerializedDockview(layout)) layouts[key] = layout;
  }
  return layouts;
}

function sanitizeLastFocusedEntries(
  workspaceId: string,
  value: unknown,
): LastFocusedPanelsByKind {
  if (!isRecord(value)) return {};
  const entries: LastFocusedPanelsByKind = {};
  for (const [kind, entry] of Object.entries(value)) {
    if (!isRecord(entry)) continue;
    const { panelId, params } = entry;
    if (typeof panelId !== "string" || panelId === "") continue;
    if (!isWorkbenchTabParams(params)) continue;
    if (params.kind !== kind || params.kind === "launcher") continue;
    if (params.workspaceId !== workspaceId) continue;
    entries[params.kind] = { panelId, params };
  }
  return entries;
}

function sanitizeLastFocused(
  value: unknown,
): Record<string, LastFocusedPanelsByKind> {
  if (!isRecord(value)) return {};
  const byWorkspace: Record<string, LastFocusedPanelsByKind> = {};
  for (const [workspaceId, entries] of Object.entries(value)) {
    const sanitized = sanitizeLastFocusedEntries(workspaceId, entries);
    if (Object.keys(sanitized).length > 0) byWorkspace[workspaceId] = sanitized;
  }
  return byWorkspace;
}

function withLastFocused(
  byWorkspace: Record<string, LastFocusedPanelsByKind>,
  workspaceId: string,
  entry: LastFocusedPanel,
): Record<string, LastFocusedPanelsByKind> {
  return {
    ...byWorkspace,
    [workspaceId]: { ...byWorkspace[workspaceId], [entry.params.kind]: entry },
  };
}

// Returns the same object when every key is kept so subscribers don't re-render.
function keepRecordKeys<Value>(
  record: Record<string, Value>,
  shouldKeepKey: (key: string) => boolean,
): Record<string, Value> {
  const keptEntries = Object.entries(record).filter(([key]) =>
    shouldKeepKey(key),
  );
  if (keptEntries.length === Object.keys(record).length) return record;
  return Object.fromEntries(keptEntries);
}

export function selectLastFocusedChatSessionId(
  state: Pick<WorkbenchState, "lastFocusedPanelByWorkspace">,
  workspaceId: string,
): string | null {
  const params = state.lastFocusedPanelByWorkspace[workspaceId]?.chat?.params;
  return params?.kind === "chat" ? params.sessionId : null;
}

export const useWorkbenchStore = create<WorkbenchState>()(
  persist(
    (set, get) => ({
      layoutsByKey: {},
      lastFocusedPanelByWorkspace: {},
      focusedPanel: null,
      layoutReadyWorkspaceId: null,
      pendingChatTarget: null,
      panelFocusRequest: null,

      saveLayout: (key, layout) =>
        set((state) => ({
          layoutsByKey: { ...state.layoutsByKey, [key]: layout },
        })),

      getLayout: (key) => get().layoutsByKey[key] ?? null,

      setFocusedPanel: (focusedPanel) =>
        set((state) => {
          if (
            focusedPanel === null ||
            focusedPanel.params.kind === "launcher"
          ) {
            return { focusedPanel };
          }
          const { workspaceId, panelId, params } = focusedPanel;
          return {
            focusedPanel,
            lastFocusedPanelByWorkspace: withLastFocused(
              state.lastFocusedPanelByWorkspace,
              workspaceId,
              { panelId, params },
            ),
          };
        }),

      updateLastFocusedParams: (workspaceId, panelId, params) =>
        set((state) => {
          const current =
            state.lastFocusedPanelByWorkspace[workspaceId]?.[params.kind];
          const isLastFocused =
            params.kind !== "launcher" && current?.panelId === panelId;
          const isFocused =
            state.focusedPanel?.workspaceId === workspaceId &&
            state.focusedPanel.panelId === panelId;
          if (!isLastFocused && !isFocused) return state;
          return {
            lastFocusedPanelByWorkspace: isLastFocused
              ? withLastFocused(
                  state.lastFocusedPanelByWorkspace,
                  workspaceId,
                  {
                    panelId,
                    params,
                  },
                )
              : state.lastFocusedPanelByWorkspace,
            focusedPanel: isFocused
              ? { workspaceId, panelId, params }
              : state.focusedPanel,
          };
        }),

      forgetPanel: (workspaceId, panelId) =>
        set((state) => {
          const isFocused =
            state.focusedPanel?.workspaceId === workspaceId &&
            state.focusedPanel.panelId === panelId;
          const entries = state.lastFocusedPanelByWorkspace[workspaceId] ?? {};
          const remainingEntries: LastFocusedPanelsByKind = { ...entries };
          for (const entry of Object.values(entries)) {
            if (entry.panelId === panelId) {
              delete remainingEntries[entry.params.kind];
            }
          }
          const hasRemovedEntry =
            Object.keys(remainingEntries).length !==
            Object.keys(entries).length;
          if (!hasRemovedEntry && !isFocused) return state;
          return {
            focusedPanel: isFocused ? null : state.focusedPanel,
            lastFocusedPanelByWorkspace: hasRemovedEntry
              ? {
                  ...state.lastFocusedPanelByWorkspace,
                  [workspaceId]: remainingEntries,
                }
              : state.lastFocusedPanelByWorkspace,
          };
        }),

      setLayoutReadyWorkspaceId: (layoutReadyWorkspaceId) =>
        set({ layoutReadyWorkspaceId }),

      requestChatTarget: (pendingChatTarget) => set({ pendingChatTarget }),

      takePendingChatTarget: (workspaceId) => {
        const target = get().pendingChatTarget;
        if (target === null || target.workspaceId !== workspaceId) return null;
        set({ pendingChatTarget: null });
        return target;
      },

      requestPanelFocus: (panelFocusRequest) => set({ panelFocusRequest }),

      takePanelFocusRequest: (panelId) => {
        if (get().panelFocusRequest !== panelId) return false;
        set({ panelFocusRequest: null });
        return true;
      },

      pruneWorkspaces: (knownWorkspaceIds) =>
        set((state) => {
          const knownIds = new Set(knownWorkspaceIds);
          const layoutsByKey = keepRecordKeys(state.layoutsByKey, (key) =>
            knownIds.has(workspaceIdFromLayoutKey(key)),
          );
          const lastFocusedPanelByWorkspace = keepRecordKeys(
            state.lastFocusedPanelByWorkspace,
            (workspaceId) => knownIds.has(workspaceId),
          );
          if (
            layoutsByKey === state.layoutsByKey &&
            lastFocusedPanelByWorkspace === state.lastFocusedPanelByWorkspace
          ) {
            return state;
          }
          return { layoutsByKey, lastFocusedPanelByWorkspace };
        }),
    }),
    {
      name: "dev-hub:workbench",
      version: 1,
      storage: createUnchangedPersistStorage<PersistedWorkbenchState>(),
      partialize: (state): PersistedWorkbenchState => ({
        layoutsByKey: state.layoutsByKey,
        lastFocusedPanelByWorkspace: state.lastFocusedPanelByWorkspace,
      }),
      merge: (persisted, current) => {
        const persistedObject = isRecord(persisted) ? persisted : {};
        return {
          ...current,
          layoutsByKey: sanitizeLayouts(persistedObject.layoutsByKey),
          lastFocusedPanelByWorkspace: sanitizeLastFocused(
            persistedObject.lastFocusedPanelByWorkspace,
          ),
        };
      },
    },
  ),
);

export function getLastFocusedChatSessionId(
  workspaceId: string,
): string | null {
  return selectLastFocusedChatSessionId(
    useWorkbenchStore.getState(),
    workspaceId,
  );
}

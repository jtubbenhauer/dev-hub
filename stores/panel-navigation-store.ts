import type { RefObject } from "react"
import { create } from "zustand"

export type PanelActionHandler = () => void

export type StandardAction =
  | "focus-input"
  | "search"
  | "navigate-next"
  | "navigate-prev"
  | "select-item"
  | "dismiss"

export type StandardActions = Partial<Record<StandardAction, PanelActionHandler>>

export type PanelDirection = "left" | "right" | "up" | "down"

export interface PanelNeighbors {
  left?: string
  right?: string
  up?: string
  down?: string
}

export interface PanelInfo {
  id: string
  neighbors: PanelNeighbors
  focusRef: RefObject<HTMLElement | null>
  containerRef: RefObject<HTMLElement | null>
  isVisible: boolean
  actions: StandardActions
}

interface PanelNavigationState {
  enabled: boolean
  activePanel: string | null
  panels: Map<string, PanelInfo>

  setEnabled: (enabled: boolean) => void
  focusPanel: (id: string) => void
  navigateDirection: (direction: PanelDirection) => void
  dispatchAction: (action: StandardAction) => void
  registerPanel: (info: PanelInfo) => void
  deregisterPanel: (id: string) => void
  setPanelVisibility: (id: string, visible: boolean) => void
  updatePanelActions: (id: string, actions: StandardActions) => void
}

function findVisibleNeighbor(
  panels: Map<string, PanelInfo>,
  startId: string,
  direction: PanelDirection,
): string | null {
  const visited = new Set<string>()
  let currentId: string | undefined = panels.get(startId)?.neighbors[direction]

  while (currentId && !visited.has(currentId)) {
    visited.add(currentId)
    const panel = panels.get(currentId)
    if (!panel) return null
    if (panel.isVisible) return currentId
    currentId = panel.neighbors[direction]
  }

  return null
}

function findFirstVisiblePanel(panels: Map<string, PanelInfo>): string | null {
  for (const [id, panel] of panels) {
    if (panel.isVisible) return id
  }
  return null
}

export const usePanelNavigationStore = create<PanelNavigationState>()(
  (set, get) => ({
    enabled: false,
    activePanel: null,
    panels: new Map(),

    setEnabled: (enabled) => set({ enabled, activePanel: enabled ? get().activePanel : null }),

    focusPanel: (id) => {
      const { panels, enabled } = get()
      if (!enabled) return
      const panel = panels.get(id)
      if (!panel || !panel.isVisible) return
      set({ activePanel: id })
      panel.focusRef.current?.focus()
    },

    navigateDirection: (direction) => {
      const { activePanel, panels, enabled } = get()
      if (!enabled) return

      if (!activePanel) {
        const firstId = findFirstVisiblePanel(panels)
        if (firstId) {
          set({ activePanel: firstId })
          panels.get(firstId)?.focusRef.current?.focus()
        }
        return
      }

      const targetId = findVisibleNeighbor(panels, activePanel, direction)
      if (targetId) {
        set({ activePanel: targetId })
        panels.get(targetId)?.focusRef.current?.focus()
      }
    },

    dispatchAction: (action) => {
      const { activePanel, panels, enabled } = get()
      if (!enabled) return
      if (activePanel) {
        panels.get(activePanel)?.actions[action]?.()
        return
      }
      // No active panel — fall back to first visible panel that supports this action
      for (const [, panel] of panels) {
        if (panel.isVisible && panel.actions[action]) {
          panel.actions[action]!()
          return
        }
      }
    },

    registerPanel: (info) =>
      set((state) => {
        const next = new Map(state.panels)
        next.set(info.id, info)
        const activePanel = state.activePanel ?? (state.enabled && info.isVisible ? info.id : null)
        return { panels: next, activePanel }
      }),

    deregisterPanel: (id) =>
      set((state) => {
        const next = new Map(state.panels)
        next.delete(id)
        const activePanel = state.activePanel === id ? findFirstVisiblePanel(next) : state.activePanel
        return { panels: next, activePanel }
      }),

    setPanelVisibility: (id, visible) =>
      set((state) => {
        const panel = state.panels.get(id)
        if (!panel) return state
        const next = new Map(state.panels)
        next.set(id, { ...panel, isVisible: visible })
        const activePanel =
          state.activePanel === id && !visible
            ? findFirstVisiblePanel(next)
            : state.activePanel
        return { panels: next, activePanel }
      }),

    updatePanelActions: (id, actions) =>
      set((state) => {
        const panel = state.panels.get(id)
        if (!panel) return state
        const next = new Map(state.panels)
        next.set(id, { ...panel, actions })
        return { panels: next }
      }),
  }),
)

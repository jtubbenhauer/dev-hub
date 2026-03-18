"use client"

import type { ReactNode } from "react"
import { createElement, useEffect, useRef } from "react"
import { useIsMobile } from "@/hooks/use-mobile"
import { usePanelNavigationSetting } from "@/hooks/use-settings"
import type { PanelNeighbors, StandardActions } from "@/stores/panel-navigation-store"
import { usePanelNavigationStore } from "@/stores/panel-navigation-store"

interface UsePanelZoneOptions {
  neighbors: PanelNeighbors
  focusRef: React.RefObject<HTMLElement | null>
  isVisible?: boolean
  actions?: StandardActions
  onFocus?: () => void
}

interface UsePanelZoneReturn {
  containerRef: React.RefObject<HTMLDivElement | null>
  isActive: boolean
  Indicator: ReactNode
}

export function usePanelZone(
  id: string,
  options: UsePanelZoneOptions,
): UsePanelZoneReturn {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const isMobile = useIsMobile()
  const { isPanelNavigationEnabled } = usePanelNavigationSetting()
  const isEnabled = isPanelNavigationEnabled && !isMobile
  const isVisible = options.isVisible ?? true

  const activePanel = usePanelNavigationStore((s) => s.activePanel)
  const registerPanel = usePanelNavigationStore((s) => s.registerPanel)
  const deregisterPanel = usePanelNavigationStore((s) => s.deregisterPanel)
  const setPanelVisibility = usePanelNavigationStore((s) => s.setPanelVisibility)
  const updatePanelActions = usePanelNavigationStore((s) => s.updatePanelActions)
  const setEnabled = usePanelNavigationStore((s) => s.setEnabled)

  const isActive = isEnabled && activePanel === id

  // Sync enabled state with store
  useEffect(() => {
    setEnabled(isEnabled)
  }, [isEnabled, setEnabled])

  // Register/deregister panel
  useEffect(() => {
    if (!isEnabled) return

    registerPanel({
      id,
      neighbors: options.neighbors,
      focusRef: options.focusRef,
      containerRef,
      isVisible,
      actions: options.actions ?? {},
    })

    return () => {
      deregisterPanel(id)
    }
    // Only re-register when id or enabled state changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, isEnabled, registerPanel, deregisterPanel])

  // Sync visibility
  useEffect(() => {
    if (!isEnabled) return
    setPanelVisibility(id, isVisible)
  }, [id, isEnabled, isVisible, setPanelVisibility])

  // Sync actions when they change
  const actionsRef = useRef(options.actions)
  useEffect(() => {
    actionsRef.current = options.actions
  })

  useEffect(() => {
    if (!isEnabled) return
    updatePanelActions(id, actionsRef.current ?? {})
  }, [id, isEnabled, updatePanelActions, options.actions])

  // Call onFocus callback when this panel becomes active
  const onFocusRef = useRef(options.onFocus)
  useEffect(() => {
    onFocusRef.current = options.onFocus
  })

  useEffect(() => {
    if (isActive) {
      onFocusRef.current?.()
    }
  }, [isActive])

  // Activate panel on click (pointerdown) without stealing DOM focus
  useEffect(() => {
    if (!isEnabled || !isVisible) return
    const el = containerRef.current
    if (!el) return
    const onPointerDown = () => {
      if (usePanelNavigationStore.getState().activePanel !== id) {
        usePanelNavigationStore.setState({ activePanel: id })
      }
    }
    el.addEventListener("pointerdown", onPointerDown)
    return () => el.removeEventListener("pointerdown", onPointerDown)
  }, [id, isEnabled, isVisible])

  const indicator: ReactNode = isActive
    ? createElement("div", {
        className: "pointer-events-none absolute inset-[2px] z-50 rounded-md border-[1.5px] border-primary/35",
      })
    : null

  return {
    containerRef,
    isActive,
    Indicator: indicator,
  }
}

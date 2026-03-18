"use client"

import { useEffect, useMemo, useRef } from "react"
import { useLeaderAction } from "@/hooks/use-leader-action"
import { usePanelNavigationSetting } from "@/hooks/use-settings"
import { useIsMobile } from "@/hooks/use-mobile"
import { usePanelNavigationStore } from "@/stores/panel-navigation-store"

function isInputFocused(): boolean {
  const el = document.activeElement
  if (!el) return false
  const tag = el.tagName
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true
  if ((el as HTMLElement).isContentEditable) return true
  if (el.closest(".cm-editor")) return true
  return false
}

function PanelNavCommandsInner() {
  const navigateDirection = usePanelNavigationStore((s) => s.navigateDirection)
  const dispatchAction = usePanelNavigationStore((s) => s.dispatchAction)

  const navigateRef = useRef(navigateDirection)
  const dispatchRef = useRef(dispatchAction)
  navigateRef.current = navigateDirection
  dispatchRef.current = dispatchAction

  const leaderActions = useMemo(
    () => [
      {
        action: { id: "panel:focus-left", label: "Focus panel left", page: "global" as const },
        handler: () => navigateRef.current("left"),
      },
      {
        action: { id: "panel:focus-down", label: "Focus panel below", page: "global" as const },
        handler: () => navigateRef.current("down"),
      },
      {
        action: { id: "panel:focus-up", label: "Focus panel above", page: "global" as const },
        handler: () => navigateRef.current("up"),
      },
      {
        action: { id: "panel:focus-right", label: "Focus panel right", page: "global" as const },
        handler: () => navigateRef.current("right"),
      },
      {
        action: { id: "panel:focus-input", label: "Focus input", page: "global" as const },
        handler: () => dispatchRef.current("focus-input"),
      },
      {
        action: { id: "panel:search", label: "Search in panel", page: "global" as const },
        handler: () => dispatchRef.current("search"),
      },
    ],
    [],
  )

  useLeaderAction(leaderActions)

  // Direct key listeners for j/k/Enter/Escape
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.ctrlKey || e.altKey || e.metaKey) return
      if (isInputFocused()) return

      switch (e.key) {
        case "j":
          e.preventDefault()
          dispatchRef.current("navigate-next")
          break
        case "k":
          e.preventDefault()
          dispatchRef.current("navigate-prev")
          break
        case "Enter":
          dispatchRef.current("select-item")
          break
        case "Escape":
          dispatchRef.current("dismiss")
          break
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [])

  return null
}

export function PanelNavCommands() {
  const { isPanelNavigationEnabled } = usePanelNavigationSetting()
  const isMobile = useIsMobile()

  if (!isPanelNavigationEnabled || isMobile) return null
  return <PanelNavCommandsInner />
}

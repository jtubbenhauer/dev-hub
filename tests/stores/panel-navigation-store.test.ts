import { describe, it, expect, beforeEach, vi } from "vitest"
import { usePanelNavigationStore } from "@/stores/panel-navigation-store"
import type { PanelInfo } from "@/stores/panel-navigation-store"

function makeRef<T>(value: T | null = null) {
  return { current: value }
}

function makePanel(
  id: string,
  neighbors: PanelInfo["neighbors"] = {},
  overrides: Partial<PanelInfo> = {},
): PanelInfo {
  return {
    id,
    neighbors,
    focusRef: makeRef<HTMLElement>(),
    containerRef: makeRef<HTMLElement>(),
    isVisible: true,
    actions: {},
    ...overrides,
  }
}

function resetStore() {
  usePanelNavigationStore.setState({
    enabled: false,
    activePanel: null,
    panels: new Map(),
  })
}

describe("panel-navigation-store", () => {
  beforeEach(resetStore)

  describe("setEnabled", () => {
    it("enables panel navigation", () => {
      usePanelNavigationStore.getState().setEnabled(true)
      expect(usePanelNavigationStore.getState().enabled).toBe(true)
    })

    it("clears activePanel when disabled", () => {
      const store = usePanelNavigationStore.getState()
      store.setEnabled(true)
      store.registerPanel(makePanel("a"))
      expect(usePanelNavigationStore.getState().activePanel).toBe("a")

      usePanelNavigationStore.getState().setEnabled(false)
      expect(usePanelNavigationStore.getState().activePanel).toBeNull()
    })

    it("preserves activePanel when re-enabled", () => {
      const store = usePanelNavigationStore.getState()
      store.setEnabled(true)
      store.registerPanel(makePanel("a"))
      const activeBeforeDisable = usePanelNavigationStore.getState().activePanel

      store.setEnabled(true)
      expect(usePanelNavigationStore.getState().activePanel).toBe(activeBeforeDisable)
    })
  })

  describe("registerPanel", () => {
    it("adds a panel to the store", () => {
      usePanelNavigationStore.getState().registerPanel(makePanel("sidebar"))
      expect(usePanelNavigationStore.getState().panels.has("sidebar")).toBe(true)
    })

    it("sets first visible panel as active when enabled", () => {
      usePanelNavigationStore.getState().setEnabled(true)
      usePanelNavigationStore.getState().registerPanel(makePanel("sidebar"))
      expect(usePanelNavigationStore.getState().activePanel).toBe("sidebar")
    })

    it("does not set activePanel when disabled", () => {
      usePanelNavigationStore.getState().registerPanel(makePanel("sidebar"))
      expect(usePanelNavigationStore.getState().activePanel).toBeNull()
    })

    it("does not override existing activePanel when registering second panel", () => {
      usePanelNavigationStore.getState().setEnabled(true)
      usePanelNavigationStore.getState().registerPanel(makePanel("a"))
      usePanelNavigationStore.getState().registerPanel(makePanel("b"))
      expect(usePanelNavigationStore.getState().activePanel).toBe("a")
    })

    it("does not set invisible panel as active", () => {
      usePanelNavigationStore.getState().setEnabled(true)
      usePanelNavigationStore.getState().registerPanel(
        makePanel("hidden", {}, { isVisible: false })
      )
      expect(usePanelNavigationStore.getState().activePanel).toBeNull()
    })
  })

  describe("deregisterPanel", () => {
    it("removes a panel from the store", () => {
      usePanelNavigationStore.getState().registerPanel(makePanel("a"))
      usePanelNavigationStore.getState().deregisterPanel("a")
      expect(usePanelNavigationStore.getState().panels.has("a")).toBe(false)
    })

    it("resets activePanel to first visible when active panel is deregistered", () => {
      usePanelNavigationStore.getState().setEnabled(true)
      usePanelNavigationStore.getState().registerPanel(makePanel("a", { right: "b" }))
      usePanelNavigationStore.getState().registerPanel(makePanel("b", { left: "a" }))
      usePanelNavigationStore.getState().focusPanel("a")

      usePanelNavigationStore.getState().deregisterPanel("a")
      expect(usePanelNavigationStore.getState().activePanel).toBe("b")
    })

    it("does not change activePanel when a non-active panel is deregistered", () => {
      usePanelNavigationStore.getState().setEnabled(true)
      usePanelNavigationStore.getState().registerPanel(makePanel("a"))
      usePanelNavigationStore.getState().registerPanel(makePanel("b"))

      usePanelNavigationStore.getState().deregisterPanel("b")
      expect(usePanelNavigationStore.getState().activePanel).toBe("a")
    })
  })

  describe("focusPanel", () => {
    it("sets activePanel and calls focus on focusRef", () => {
      const focusFn = vi.fn()
      const focusRef = makeRef({ focus: focusFn } as unknown as HTMLElement)
      usePanelNavigationStore.getState().setEnabled(true)
      usePanelNavigationStore.getState().registerPanel(
        makePanel("a", {}, { focusRef })
      )
      usePanelNavigationStore.getState().registerPanel(makePanel("b"))

      usePanelNavigationStore.getState().focusPanel("b")
      // b's focusRef is a bare ref with null, so focus is not called
      expect(usePanelNavigationStore.getState().activePanel).toBe("b")

      usePanelNavigationStore.getState().focusPanel("a")
      expect(usePanelNavigationStore.getState().activePanel).toBe("a")
      expect(focusFn).toHaveBeenCalled()
    })

    it("does nothing when disabled", () => {
      usePanelNavigationStore.getState().registerPanel(makePanel("a"))
      usePanelNavigationStore.getState().focusPanel("a")
      expect(usePanelNavigationStore.getState().activePanel).toBeNull()
    })

    it("does nothing for invisible panel", () => {
      usePanelNavigationStore.getState().setEnabled(true)
      usePanelNavigationStore.getState().registerPanel(
        makePanel("a", {}, { isVisible: false })
      )
      usePanelNavigationStore.getState().focusPanel("a")
      expect(usePanelNavigationStore.getState().activePanel).toBeNull()
    })

    it("does nothing for non-existent panel", () => {
      usePanelNavigationStore.getState().setEnabled(true)
      usePanelNavigationStore.getState().focusPanel("nonexistent")
      expect(usePanelNavigationStore.getState().activePanel).toBeNull()
    })
  })

  describe("navigateDirection", () => {
    it("navigates to a visible neighbor", () => {
      usePanelNavigationStore.getState().setEnabled(true)
      usePanelNavigationStore.getState().registerPanel(makePanel("a", { right: "b" }))
      usePanelNavigationStore.getState().registerPanel(makePanel("b", { left: "a" }))
      usePanelNavigationStore.getState().focusPanel("a")

      usePanelNavigationStore.getState().navigateDirection("right")
      expect(usePanelNavigationStore.getState().activePanel).toBe("b")
    })

    it("skips hidden panels and finds next visible one", () => {
      usePanelNavigationStore.getState().setEnabled(true)
      usePanelNavigationStore.getState().registerPanel(makePanel("a", { right: "b" }))
      usePanelNavigationStore.getState().registerPanel(
        makePanel("b", { left: "a", right: "c" }, { isVisible: false })
      )
      usePanelNavigationStore.getState().registerPanel(makePanel("c", { left: "b" }))
      usePanelNavigationStore.getState().focusPanel("a")

      usePanelNavigationStore.getState().navigateDirection("right")
      expect(usePanelNavigationStore.getState().activePanel).toBe("c")
    })

    it("does nothing when there is no neighbor in that direction", () => {
      usePanelNavigationStore.getState().setEnabled(true)
      usePanelNavigationStore.getState().registerPanel(makePanel("a", { right: "b" }))
      usePanelNavigationStore.getState().registerPanel(makePanel("b", { left: "a" }))
      usePanelNavigationStore.getState().focusPanel("b")

      usePanelNavigationStore.getState().navigateDirection("right")
      expect(usePanelNavigationStore.getState().activePanel).toBe("b")
    })

    it("focuses first visible panel when no active panel exists", () => {
      usePanelNavigationStore.getState().setEnabled(true)
      usePanelNavigationStore.getState().registerPanel(makePanel("a"))
      usePanelNavigationStore.getState().registerPanel(makePanel("b"))
      // Reset activePanel to null manually
      usePanelNavigationStore.setState({ activePanel: null })

      usePanelNavigationStore.getState().navigateDirection("right")
      expect(usePanelNavigationStore.getState().activePanel).toBe("a")
    })

    it("does nothing when disabled", () => {
      usePanelNavigationStore.getState().registerPanel(makePanel("a", { right: "b" }))
      usePanelNavigationStore.getState().registerPanel(makePanel("b", { left: "a" }))

      usePanelNavigationStore.getState().navigateDirection("right")
      expect(usePanelNavigationStore.getState().activePanel).toBeNull()
    })

    it("navigates vertically with up/down neighbors", () => {
      usePanelNavigationStore.getState().setEnabled(true)
      usePanelNavigationStore.getState().registerPanel(makePanel("top", { down: "bottom" }))
      usePanelNavigationStore.getState().registerPanel(makePanel("bottom", { up: "top" }))
      usePanelNavigationStore.getState().focusPanel("top")

      usePanelNavigationStore.getState().navigateDirection("down")
      expect(usePanelNavigationStore.getState().activePanel).toBe("bottom")

      usePanelNavigationStore.getState().navigateDirection("up")
      expect(usePanelNavigationStore.getState().activePanel).toBe("top")
    })

    it("prevents infinite loops when neighbors form a cycle of hidden panels", () => {
      usePanelNavigationStore.getState().setEnabled(true)
      usePanelNavigationStore.getState().registerPanel(makePanel("a", { right: "b" }))
      usePanelNavigationStore.getState().registerPanel(
        makePanel("b", { right: "c" }, { isVisible: false })
      )
      usePanelNavigationStore.getState().registerPanel(
        makePanel("c", { right: "b" }, { isVisible: false })
      )
      usePanelNavigationStore.getState().focusPanel("a")

      usePanelNavigationStore.getState().navigateDirection("right")
      expect(usePanelNavigationStore.getState().activePanel).toBe("a")
    })
  })

  describe("dispatchAction", () => {
    it("calls the action handler on the active panel", () => {
      const handler = vi.fn()
      usePanelNavigationStore.getState().setEnabled(true)
      usePanelNavigationStore.getState().registerPanel(
        makePanel("a", {}, { actions: { "navigate-next": handler } })
      )
      usePanelNavigationStore.getState().focusPanel("a")

      usePanelNavigationStore.getState().dispatchAction("navigate-next")
      expect(handler).toHaveBeenCalledOnce()
    })

    it("does nothing when disabled", () => {
      const handler = vi.fn()
      usePanelNavigationStore.getState().registerPanel(
        makePanel("a", {}, { actions: { "navigate-next": handler } })
      )

      usePanelNavigationStore.getState().dispatchAction("navigate-next")
      expect(handler).not.toHaveBeenCalled()
    })

    it("falls back to first visible panel with the action when no active panel", () => {
      const handler = vi.fn()
      usePanelNavigationStore.getState().setEnabled(true)
      usePanelNavigationStore.getState().registerPanel(
        makePanel("a", {}, { actions: { "navigate-next": handler } })
      )
      usePanelNavigationStore.setState({ activePanel: null })

      usePanelNavigationStore.getState().dispatchAction("navigate-next")
      expect(handler).toHaveBeenCalledOnce()
    })

    it("skips hidden panels in fallback when no active panel", () => {
      const hiddenHandler = vi.fn()
      const visibleHandler = vi.fn()
      usePanelNavigationStore.getState().setEnabled(true)
      usePanelNavigationStore.getState().registerPanel(
        makePanel("a", {}, { actions: { "focus-input": hiddenHandler }, isVisible: false })
      )
      usePanelNavigationStore.getState().registerPanel(
        makePanel("b", {}, { actions: { "focus-input": visibleHandler } })
      )
      usePanelNavigationStore.setState({ activePanel: null })

      usePanelNavigationStore.getState().dispatchAction("focus-input")
      expect(hiddenHandler).not.toHaveBeenCalled()
      expect(visibleHandler).toHaveBeenCalledOnce()
    })

    it("does nothing in fallback when no panel supports the action", () => {
      usePanelNavigationStore.getState().setEnabled(true)
      usePanelNavigationStore.getState().registerPanel(makePanel("a"))
      usePanelNavigationStore.setState({ activePanel: null })

      // Should not throw
      usePanelNavigationStore.getState().dispatchAction("focus-input")
    })

    it("does nothing when action is not defined on active panel", () => {
      usePanelNavigationStore.getState().setEnabled(true)
      usePanelNavigationStore.getState().registerPanel(makePanel("a"))
      usePanelNavigationStore.getState().focusPanel("a")

      // Should not throw
      usePanelNavigationStore.getState().dispatchAction("navigate-next")
    })
  })

  describe("setPanelVisibility", () => {
    it("updates panel visibility", () => {
      usePanelNavigationStore.getState().registerPanel(makePanel("a"))
      usePanelNavigationStore.getState().setPanelVisibility("a", false)

      const panel = usePanelNavigationStore.getState().panels.get("a")
      expect(panel?.isVisible).toBe(false)
    })

    it("resets activePanel when active panel becomes hidden", () => {
      usePanelNavigationStore.getState().setEnabled(true)
      usePanelNavigationStore.getState().registerPanel(makePanel("a"))
      usePanelNavigationStore.getState().registerPanel(makePanel("b"))
      usePanelNavigationStore.getState().focusPanel("a")

      usePanelNavigationStore.getState().setPanelVisibility("a", false)
      expect(usePanelNavigationStore.getState().activePanel).toBe("b")
    })

    it("does not change activePanel when non-active panel becomes hidden", () => {
      usePanelNavigationStore.getState().setEnabled(true)
      usePanelNavigationStore.getState().registerPanel(makePanel("a"))
      usePanelNavigationStore.getState().registerPanel(makePanel("b"))
      usePanelNavigationStore.getState().focusPanel("a")

      usePanelNavigationStore.getState().setPanelVisibility("b", false)
      expect(usePanelNavigationStore.getState().activePanel).toBe("a")
    })

    it("sets activePanel to null when all panels are hidden", () => {
      usePanelNavigationStore.getState().setEnabled(true)
      usePanelNavigationStore.getState().registerPanel(makePanel("a"))
      usePanelNavigationStore.getState().focusPanel("a")

      usePanelNavigationStore.getState().setPanelVisibility("a", false)
      expect(usePanelNavigationStore.getState().activePanel).toBeNull()
    })

    it("does nothing for non-existent panel", () => {
      const stateBefore = usePanelNavigationStore.getState()
      usePanelNavigationStore.getState().setPanelVisibility("nonexistent", true)
      // Should not throw and panels should be unchanged
      expect(usePanelNavigationStore.getState().panels.size).toBe(stateBefore.panels.size)
    })
  })

  describe("updatePanelActions", () => {
    it("updates actions on an existing panel", () => {
      const handler = vi.fn()
      usePanelNavigationStore.getState().setEnabled(true)
      usePanelNavigationStore.getState().registerPanel(makePanel("a"))

      usePanelNavigationStore.getState().updatePanelActions("a", { "focus-input": handler })

      usePanelNavigationStore.getState().focusPanel("a")
      usePanelNavigationStore.getState().dispatchAction("focus-input")
      expect(handler).toHaveBeenCalledOnce()
    })

    it("does nothing for non-existent panel", () => {
      const stateBefore = usePanelNavigationStore.getState()
      usePanelNavigationStore.getState().updatePanelActions("nonexistent", {})
      expect(usePanelNavigationStore.getState().panels.size).toBe(stateBefore.panels.size)
    })
  })
})

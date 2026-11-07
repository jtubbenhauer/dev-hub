import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useActiveTabInView } from "@/components/workbench/use-active-tab-in-view";

interface TabLayout {
  readonly offsetLeft: number;
  readonly offsetWidth: number;
  readonly isActive: boolean;
}

function installControlledResizeObserver() {
  const notifyCallbacks: Array<() => void> = [];
  const observedTargets = new Set<Element>();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: ResizeObserverCallback) {
        notifyCallbacks.push(() => callback([], this));
      }
      observe(target: Element) {
        observedTargets.add(target);
      }
      unobserve(target: Element) {
        observedTargets.delete(target);
      }
      disconnect() {
        observedTargets.clear();
      }
    },
  );
  return {
    notifyResize: () => notifyCallbacks.forEach((notify) => notify()),
    observedTargets,
  };
}

// jsdom has no layout, so each tab's position and the strip's width are given.
function createTabElement(tab: TabLayout): HTMLElement {
  const tabElement = document.createElement("div");
  tabElement.className = tab.isActive
    ? "dv-tab dv-active-tab"
    : "dv-tab dv-inactive-tab";
  Object.defineProperty(tabElement, "offsetLeft", { value: tab.offsetLeft });
  Object.defineProperty(tabElement, "offsetWidth", { value: tab.offsetWidth });
  return tabElement;
}

function createGroupElement(tabs: readonly TabLayout[], stripWidth: number) {
  const groupElement = document.createElement("div");
  const tabStrip = document.createElement("div");
  tabStrip.className = "dv-tabs-container";
  Object.defineProperty(tabStrip, "clientWidth", { value: stripWidth });
  let scrollLeft = 0;
  Object.defineProperty(tabStrip, "scrollLeft", {
    get: () => scrollLeft,
    set: (value: number) => {
      scrollLeft = value;
    },
  });
  for (const tab of tabs) tabStrip.appendChild(createTabElement(tab));
  groupElement.appendChild(tabStrip);
  return { groupElement, tabStrip };
}

const THREE_TABS_LAST_ACTIVE: readonly TabLayout[] = [
  { offsetLeft: 0, offsetWidth: 127, isActive: false },
  { offsetLeft: 127, offsetWidth: 240, isActive: false },
  { offsetLeft: 367, offsetWidth: 240, isActive: true },
];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useActiveTabInView", () => {
  it("scrolls a clipped active tab into view once the strip has a width", () => {
    // Given a restored 320px strip whose active third tab starts at 367px
    const { notifyResize } = installControlledResizeObserver();
    const { groupElement, tabStrip } = createGroupElement(
      THREE_TABS_LAST_ACTIVE,
      320,
    );
    renderHook(() => useActiveTabInView(groupElement, true));

    // When the strip is laid out
    notifyResize();

    // Then the active tab starts at the strip's left edge
    expect(tabStrip.scrollLeft).toBe(367);
  });

  it("keeps a new tab in view once its title has rendered", async () => {
    // Given a strip with one tab
    const { notifyResize, observedTargets } = installControlledResizeObserver();
    const { groupElement, tabStrip } = createGroupElement(
      [{ offsetLeft: 0, offsetWidth: 127, isActive: false }],
      320,
    );
    renderHook(() => useActiveTabInView(groupElement, true));

    // When a new active tab is added and grows as its title renders
    const newTab = createTabElement({
      offsetLeft: 300,
      offsetWidth: 133,
      isActive: true,
    });
    tabStrip.appendChild(newTab);
    await waitFor(() => expect(observedTargets.has(newTab)).toBe(true));
    notifyResize();

    // Then the new tab is scrolled into view
    expect(tabStrip.scrollLeft).toBe(300);
  });

  it("stops watching a closed tab", async () => {
    // Given a watched strip of three tabs
    const { observedTargets } = installControlledResizeObserver();
    const { groupElement, tabStrip } = createGroupElement(
      THREE_TABS_LAST_ACTIVE,
      320,
    );
    renderHook(() => useActiveTabInView(groupElement, true));
    const closedTab = tabStrip.children[0];
    expect(observedTargets.has(closedTab)).toBe(true);

    // When a tab is closed
    closedTab.remove();

    // Then it is no longer observed
    await waitFor(() => expect(observedTargets.has(closedTab)).toBe(false));
  });

  it("leaves the strip alone when the active tab is already visible", () => {
    // Given the active first tab fits in the strip
    const { notifyResize } = installControlledResizeObserver();
    const { groupElement, tabStrip } = createGroupElement(
      [
        { offsetLeft: 0, offsetWidth: 127, isActive: true },
        { offsetLeft: 127, offsetWidth: 240, isActive: false },
      ],
      320,
    );
    renderHook(() => useActiveTabInView(groupElement, true));

    // When the strip resizes
    notifyResize();

    // Then it does not scroll
    expect(tabStrip.scrollLeft).toBe(0);
  });

  it("does nothing when turned off", () => {
    // Given the hook is off (the desktop layout)
    const { notifyResize, observedTargets } = installControlledResizeObserver();
    const { groupElement, tabStrip } = createGroupElement(
      THREE_TABS_LAST_ACTIVE,
      320,
    );
    renderHook(() => useActiveTabInView(groupElement, false));

    // When the strip resizes
    notifyResize();

    // Then dockview's own scrolling is left untouched
    expect(observedTargets.size).toBe(0);
    expect(tabStrip.scrollLeft).toBe(0);
  });
});

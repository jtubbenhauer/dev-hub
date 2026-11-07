import { useEffect } from "react";

// dockview scrolls a tab into view as it becomes active, but a restored layout
// activates its tab before the strip has a width, and a new tab before its
// title has rendered, so either can end up clipped. Checking again whenever
// the strip or a tab resizes fixes both and covers a phone rotating.
export function useActiveTabInView(
  groupElement: HTMLElement,
  isEnabled: boolean,
): void {
  useEffect(() => {
    if (!isEnabled) return;
    const tabStrip =
      groupElement.querySelector<HTMLElement>(".dv-tabs-container");
    if (!tabStrip) return;

    const showActiveTab = () => {
      const activeTab = tabStrip.querySelector<HTMLElement>(
        ":scope > .dv-active-tab",
      );
      if (!activeTab) return;
      const tabStart = activeTab.offsetLeft;
      const tabEnd = tabStart + activeTab.offsetWidth;
      const isClipped =
        tabStart < tabStrip.scrollLeft ||
        tabEnd > tabStrip.scrollLeft + tabStrip.clientWidth;
      if (isClipped) tabStrip.scrollLeft = tabStart;
    };

    const resizeObserver = new ResizeObserver(showActiveTab);
    resizeObserver.observe(tabStrip);
    for (const tab of tabStrip.children) resizeObserver.observe(tab);

    const tabListObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const addedNode of mutation.addedNodes) {
          if (addedNode instanceof Element) resizeObserver.observe(addedNode);
        }
        for (const removedNode of mutation.removedNodes) {
          if (removedNode instanceof Element) {
            resizeObserver.unobserve(removedNode);
          }
        }
      }
    });
    tabListObserver.observe(tabStrip, { childList: true });

    return () => {
      tabListObserver.disconnect();
      resizeObserver.disconnect();
    };
  }, [groupElement, isEnabled]);
}

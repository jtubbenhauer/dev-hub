import { afterEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useChatScrollMemory } from "@/components/chat/use-chat-scroll-memory";

const messages = [
  { info: { id: "msg-a" } },
  { info: { id: "msg-b" } },
  { info: { id: "msg-c" } },
];

function setRect(element: Element, top: number, bottom: number) {
  element.getBoundingClientRect = () =>
    ({
      top,
      bottom,
      left: 0,
      right: 0,
      width: 0,
      height: bottom - top,
    }) as DOMRect;
}

function buildScrolledScroller(options: {
  scrollTop: number;
  itemRects: Array<[number, number]>;
}): HTMLElement {
  const scroller = document.createElement("div");
  Object.defineProperty(scroller, "scrollTop", {
    value: options.scrollTop,
  });
  Object.defineProperty(scroller, "scrollHeight", { value: 2000 });
  Object.defineProperty(scroller, "clientHeight", { value: 500 });
  setRect(scroller, 0, 500);
  const itemList = document.createElement("div");
  itemList.dataset.testid = "virtuoso-item-list";
  options.itemRects.forEach(([top, bottom], index) => {
    const item = document.createElement("div");
    item.dataset.index = String(index);
    setRect(item, top, bottom);
    itemList.appendChild(item);
  });
  scroller.appendChild(itemList);
  document.body.appendChild(scroller);
  return scroller;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("useChatScrollMemory", () => {
  it("anchors to the latest message for a session never scrolled", () => {
    const { result } = renderHook(() =>
      useChatScrollMemory("ws:fresh", messages),
    );
    expect(result.current.initialScrollLocation).toBeNull();
  });

  it("restores a mid-list position after switching away and back", () => {
    const { result, rerender } = renderHook(
      ({ sessionKey }) => useChatScrollMemory(sessionKey, messages),
      { initialProps: { sessionKey: "ws:review" } },
    );
    const scroller = buildScrolledScroller({
      scrollTop: 400,
      itemRects: [
        [-300, -20],
        [-20, 600],
        [600, 900],
      ],
    });
    act(() => result.current.handleScrollerRef(scroller));
    act(() => {
      scroller.dispatchEvent(new Event("scroll"));
    });

    rerender({ sessionKey: "ws:other" });
    expect(result.current.initialScrollLocation).toBeNull();

    rerender({ sessionKey: "ws:review" });
    expect(result.current.initialScrollLocation).toEqual({
      index: 1,
      align: "start",
      offset: 20,
    });
  });

  it("anchors to the latest message when the session was left at the bottom", () => {
    const { result, rerender } = renderHook(
      ({ sessionKey }) => useChatScrollMemory(sessionKey, messages),
      { initialProps: { sessionKey: "ws:bottom" } },
    );
    const midListScroller = buildScrolledScroller({
      scrollTop: 400,
      itemRects: [[-20, 600]],
    });
    act(() => result.current.handleScrollerRef(midListScroller));
    act(() => {
      midListScroller.dispatchEvent(new Event("scroll"));
    });
    const bottomScroller = buildScrolledScroller({
      scrollTop: 1500,
      itemRects: [],
    });
    act(() => result.current.handleScrollerRef(bottomScroller));
    act(() => {
      bottomScroller.dispatchEvent(new Event("scroll"));
    });

    rerender({ sessionKey: "ws:other" });
    rerender({ sessionKey: "ws:bottom" });
    expect(result.current.initialScrollLocation).toBeNull();
  });
});

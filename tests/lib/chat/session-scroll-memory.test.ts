import { afterEach, describe, expect, it } from "vitest";
import {
  getRememberedChatScrollPosition,
  readChatScrollPosition,
  rememberChatScrollPosition,
  resolveInitialScrollLocation,
} from "@/lib/chat/session-scroll-memory";

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

function buildScroller(options: {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  viewportTop: number;
  itemRects: Array<[number, number]>;
}): HTMLElement {
  const scroller = document.createElement("div");
  Object.defineProperty(scroller, "scrollTop", { value: options.scrollTop });
  Object.defineProperty(scroller, "scrollHeight", {
    value: options.scrollHeight,
  });
  Object.defineProperty(scroller, "clientHeight", {
    value: options.clientHeight,
  });
  setRect(scroller, options.viewportTop, options.viewportTop + 500);
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

describe("rememberChatScrollPosition", () => {
  it("stores and returns the latest position per session", () => {
    rememberChatScrollPosition("ws:remember", {
      isAtBottom: false,
      messageId: "msg-a",
      offsetPx: 10,
    });
    rememberChatScrollPosition("ws:remember", { isAtBottom: true });
    expect(getRememberedChatScrollPosition("ws:remember")).toEqual({
      isAtBottom: true,
    });
  });

  it("evicts the least recently saved session past the cap", () => {
    for (let index = 0; index <= 200; index++) {
      rememberChatScrollPosition(`ws:cap-${index}`, { isAtBottom: true });
    }
    expect(getRememberedChatScrollPosition("ws:cap-0")).toBeUndefined();
    expect(getRememberedChatScrollPosition("ws:cap-1")).toEqual({
      isAtBottom: true,
    });
    expect(getRememberedChatScrollPosition("ws:cap-200")).toEqual({
      isAtBottom: true,
    });
  });
});

describe("readChatScrollPosition", () => {
  it("reports the bottom when within the auto-scroll threshold", () => {
    const scroller = buildScroller({
      scrollTop: 1450,
      scrollHeight: 2000,
      clientHeight: 500,
      viewportTop: 100,
      itemRects: [],
    });
    expect(readChatScrollPosition(scroller, messages)).toEqual({
      isAtBottom: true,
    });
  });

  it("anchors to the first message still visible at the top", () => {
    const scroller = buildScroller({
      scrollTop: 300,
      scrollHeight: 2000,
      clientHeight: 500,
      viewportTop: 100,
      itemRects: [
        [-200, 40],
        [40, 160],
        [160, 600],
      ],
    });
    expect(readChatScrollPosition(scroller, messages)).toEqual({
      isAtBottom: false,
      messageId: "msg-b",
      offsetPx: 60,
    });
  });

  it("returns null for a scroller that is no longer in the document", () => {
    const scroller = buildScroller({
      scrollTop: 300,
      scrollHeight: 2000,
      clientHeight: 500,
      viewportTop: 100,
      itemRects: [[100, 400]],
    });
    scroller.remove();
    expect(readChatScrollPosition(scroller, messages)).toBeNull();
  });
});

describe("resolveInitialScrollLocation", () => {
  it("returns null when there is no saved position or it was at the bottom", () => {
    expect(resolveInitialScrollLocation(undefined, messages)).toBeNull();
    expect(
      resolveInitialScrollLocation({ isAtBottom: true }, messages),
    ).toBeNull();
  });

  it("returns the anchor message's data index with its offset", () => {
    expect(
      resolveInitialScrollLocation(
        { isAtBottom: false, messageId: "msg-c", offsetPx: 42 },
        messages,
      ),
    ).toEqual({ index: 2, align: "start", offset: 42 });
  });

  it("returns null when the anchor message is no longer loaded", () => {
    expect(
      resolveInitialScrollLocation(
        { isAtBottom: false, messageId: "gone", offsetPx: 0 },
        messages,
      ),
    ).toBeNull();
  });
});

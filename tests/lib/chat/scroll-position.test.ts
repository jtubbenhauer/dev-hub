import { describe, it, expect } from "vitest";
import {
  isNearBottom,
  AUTO_SCROLL_THRESHOLD_PX,
} from "@/lib/chat/scroll-position";

describe("isNearBottom", () => {
  it("returns true when scrolled exactly to the bottom", () => {
    expect(
      isNearBottom({ scrollTop: 800, scrollHeight: 1000, clientHeight: 200 }),
    ).toBe(true);
  });

  it("returns true when within the default threshold of the bottom", () => {
    expect(
      isNearBottom({ scrollTop: 750, scrollHeight: 1000, clientHeight: 200 }),
    ).toBe(true);
  });

  it("returns true at the exact threshold boundary", () => {
    const scrollTop = 1000 - 200 - AUTO_SCROLL_THRESHOLD_PX;
    expect(
      isNearBottom({ scrollTop, scrollHeight: 1000, clientHeight: 200 }),
    ).toBe(true);
  });

  it("returns false one pixel beyond the threshold", () => {
    const scrollTop = 1000 - 200 - AUTO_SCROLL_THRESHOLD_PX - 1;
    expect(
      isNearBottom({ scrollTop, scrollHeight: 1000, clientHeight: 200 }),
    ).toBe(false);
  });

  it("returns false when the user has scrolled to the top of a long list", () => {
    expect(
      isNearBottom({ scrollTop: 0, scrollHeight: 5000, clientHeight: 400 }),
    ).toBe(false);
  });

  it("returns true when content fits without scrolling", () => {
    expect(
      isNearBottom({ scrollTop: 0, scrollHeight: 300, clientHeight: 300 }),
    ).toBe(true);
  });

  it("respects a custom threshold", () => {
    const metrics = { scrollTop: 600, scrollHeight: 1000, clientHeight: 200 };
    expect(isNearBottom(metrics, 150)).toBe(false);
    expect(isNearBottom(metrics, 250)).toBe(true);
  });
});

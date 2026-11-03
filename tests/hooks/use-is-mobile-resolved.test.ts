import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useIsMobileResolved } from "@/hooks/use-is-mobile-resolved";

type MediaQueryChangeListener = () => void;

interface FakeMediaQuery {
  readonly fireChange: () => void;
  readonly listenerCount: () => number;
}

// A media query list whose "change" listeners the test can fire and count.
function stubMatchMedia(): FakeMediaQuery {
  const listeners = new Set<MediaQueryChangeListener>();
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: false,
      media: query,
      addEventListener: (_type: "change", listener: MediaQueryChangeListener) =>
        listeners.add(listener),
      removeEventListener: (
        _type: "change",
        listener: MediaQueryChangeListener,
      ) => listeners.delete(listener),
    })),
  );
  return {
    fireChange: () => {
      for (const listener of listeners) listener();
    },
    listenerCount: () => listeners.size,
  };
}

function renderRecordingHook() {
  const renderedValues: (boolean | null)[] = [];
  const view = renderHook(() => {
    const isMobile = useIsMobileResolved();
    renderedValues.push(isMobile);
    return isMobile;
  });
  return { ...view, renderedValues };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useIsMobileResolved", () => {
  it("is null on the first render and false once resolved at 1024px", () => {
    // Given
    vi.stubGlobal("innerWidth", 1024);
    stubMatchMedia();

    // When
    const { result, renderedValues } = renderRecordingHook();

    // Then
    expect(renderedValues[0]).toBeNull();
    expect(result.current).toBe(false);
  });

  it("resolves to true below the 768px breakpoint", () => {
    // Given
    vi.stubGlobal("innerWidth", 375);
    stubMatchMedia();

    // When
    const { result } = renderRecordingHook();

    // Then
    expect(result.current).toBe(true);
  });

  it("follows a breakpoint change reported by the media query", () => {
    // Given
    vi.stubGlobal("innerWidth", 1024);
    const mediaQuery = stubMatchMedia();
    const { result } = renderRecordingHook();

    // When
    act(() => {
      vi.stubGlobal("innerWidth", 600);
      mediaQuery.fireChange();
    });

    // Then
    expect(result.current).toBe(true);
  });

  it("removes its media query listener on unmount", () => {
    // Given
    vi.stubGlobal("innerWidth", 1024);
    const mediaQuery = stubMatchMedia();
    const { unmount } = renderRecordingHook();
    expect(mediaQuery.listenerCount()).toBe(1);

    // When
    unmount();

    // Then
    expect(mediaQuery.listenerCount()).toBe(0);
  });

  it("still resolves from the window width when matchMedia is unavailable", () => {
    // Given
    vi.stubGlobal("innerWidth", 375);
    vi.stubGlobal("matchMedia", undefined);

    // When
    const { result } = renderRecordingHook();

    // Then
    expect(result.current).toBe(true);
  });
});

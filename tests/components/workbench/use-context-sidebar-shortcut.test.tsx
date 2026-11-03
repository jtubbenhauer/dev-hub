import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";

import { useContextSidebarShortcut } from "@/components/workbench/use-context-sidebar-shortcut";
import { useContextSidebarStore } from "@/stores/context-sidebar-store";

interface ChordInit {
  readonly code: string;
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
  readonly shiftKey?: boolean;
}

function pressOn(target: EventTarget, init: ChordInit): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    ...init,
    bubbles: true,
    cancelable: true,
  });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

beforeEach(() => {
  localStorage.clear();
  useContextSidebarStore.setState(
    useContextSidebarStore.getInitialState(),
    true,
  );
});

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
});

describe("useContextSidebarShortcut on desktop", () => {
  it.each([
    { chord: "Ctrl+\\", init: { code: "Backslash", ctrlKey: true } },
    { chord: "Cmd+\\", init: { code: "Backslash", metaKey: true } },
  ])("hides the open sidebar on $chord", ({ init }) => {
    // Given
    renderHook(() => useContextSidebarShortcut({ isMobile: false }));

    // When
    const event = pressOn(window, init);

    // Then
    expect(useContextSidebarStore.getState().isOpen).toBe(false);
    expect(event.defaultPrevented).toBe(true);
  });

  it("shows the hidden sidebar again on the next press", () => {
    // Given
    renderHook(() => useContextSidebarShortcut({ isMobile: false }));
    pressOn(window, { code: "Backslash", metaKey: true });

    // When
    pressOn(window, { code: "Backslash", metaKey: true });

    // Then
    expect(useContextSidebarStore.getState().isOpen).toBe(true);
  });

  it("toggles even when the focused element stops the key from bubbling", () => {
    // Given
    renderHook(() => useContextSidebarShortcut({ isMobile: false }));
    const terminalInput = document.createElement("textarea");
    terminalInput.addEventListener("keydown", (event) =>
      event.stopPropagation(),
    );
    document.body.append(terminalInput);

    // When
    pressOn(terminalInput, { code: "Backslash", ctrlKey: true });

    // Then
    expect(useContextSidebarStore.getState().isOpen).toBe(false);
  });

  it("leaves other workbench chords alone", () => {
    // Given
    renderHook(() => useContextSidebarShortcut({ isMobile: false }));

    // When
    const event = pressOn(window, {
      code: "BracketRight",
      ctrlKey: true,
      shiftKey: true,
    });

    // Then
    expect(useContextSidebarStore.getState().isOpen).toBe(true);
    expect(event.defaultPrevented).toBe(false);
  });

  it("stops listening once unmounted", () => {
    // Given
    const { unmount } = renderHook(() =>
      useContextSidebarShortcut({ isMobile: false }),
    );
    unmount();

    // When
    const event = pressOn(window, { code: "Backslash", ctrlKey: true });

    // Then
    expect(useContextSidebarStore.getState().isOpen).toBe(true);
    expect(event.defaultPrevented).toBe(false);
  });
});

describe("useContextSidebarShortcut on mobile", () => {
  it("opens the sheet instead of changing the desktop sidebar", () => {
    // Given
    renderHook(() => useContextSidebarShortcut({ isMobile: true }));

    // When
    pressOn(window, { code: "Backslash", ctrlKey: true });

    // Then
    const state = useContextSidebarStore.getState();
    expect(state.isMobileSheetOpen).toBe(true);
    expect(state.isOpen).toBe(true);
  });

  it("closes the open sheet on the next press", () => {
    // Given
    renderHook(() => useContextSidebarShortcut({ isMobile: true }));
    useContextSidebarStore.getState().setMobileSheetOpen(true);

    // When
    pressOn(window, { code: "Backslash", ctrlKey: true });

    // Then
    expect(useContextSidebarStore.getState().isMobileSheetOpen).toBe(false);
  });
});

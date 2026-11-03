import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { useWorkbenchChords } from "@/components/workbench/use-workbench-chords";
import { SETTINGS_KEYS } from "@/hooks/use-settings";
import { useContextSidebarStore } from "@/stores/context-sidebar-store";
import {
  mountFakeWorkbench,
  type FakeWorkbenchController,
} from "../../helpers/fake-workbench-controller";

interface ChordInit {
  readonly code: string;
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
  readonly shiftKey?: boolean;
  readonly altKey?: boolean;
  readonly repeat?: boolean;
}

let workbench: {
  readonly controller: FakeWorkbenchController;
  readonly unmount: () => void;
};

function createSettingsWrapper(settings: Record<string, unknown>) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  queryClient.setQueryData(["settings"], settings);
  return function SettingsWrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

function renderChords(settings: Record<string, unknown> = {}) {
  return renderHook(() => useWorkbenchChords(), {
    wrapper: createSettingsWrapper(settings),
  });
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

function appendElement<K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  parent: HTMLElement = document.body,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tagName);
  parent.append(element);
  return element;
}

const NEXT_TAB = { code: "BracketRight", ctrlKey: true, shiftKey: true };
const SPLIT_RIGHT = { code: "Backslash", ctrlKey: true, shiftKey: true };

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(() => new Promise<Response>(() => {})),
  );
  useContextSidebarStore.setState(
    useContextSidebarStore.getInitialState(),
    true,
  );
  workbench = mountFakeWorkbench("ws-1");
});

afterEach(() => {
  cleanup();
  workbench.unmount();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe("useWorkbenchChords tab chords", () => {
  it("cycles to the next tab on Ctrl+Shift+]", () => {
    // Given
    renderChords();

    // When
    const event = pressOn(window, NEXT_TAB);

    // Then
    expect(workbench.controller.runCommand).toHaveBeenCalledExactlyOnceWith({
      type: "cycle",
      direction: "next",
    });
    expect(event.defaultPrevented).toBe(true);
  });

  it("cycles to the previous tab on Ctrl+Shift+[", () => {
    // Given
    renderChords();

    // When
    pressOn(window, { code: "BracketLeft", ctrlKey: true, shiftKey: true });

    // Then
    expect(workbench.controller.runCommand).toHaveBeenCalledExactlyOnceWith({
      type: "cycle",
      direction: "previous",
    });
  });

  it("keeps cycling while Ctrl+Shift+] is held", () => {
    // Given
    renderChords();

    // When
    pressOn(window, { ...NEXT_TAB, repeat: true });

    // Then
    expect(workbench.controller.runCommand).toHaveBeenCalledExactlyOnceWith({
      type: "cycle",
      direction: "next",
    });
  });

  it("focuses tab 1 on Alt+1 pressed outside a text field", () => {
    // Given
    renderChords();
    const tabContent = appendElement("div");

    // When
    const event = pressOn(tabContent, { code: "Digit1", altKey: true });

    // Then
    expect(workbench.controller.runCommand).toHaveBeenCalledExactlyOnceWith({
      type: "focus-number",
      n: 1,
    });
    expect(event.defaultPrevented).toBe(true);
  });

  it("leaves Alt+1 to a focused text field", () => {
    // Given
    renderChords();
    const promptInput = appendElement("textarea");

    // When
    const event = pressOn(promptInput, { code: "Digit1", altKey: true });

    // Then
    expect(workbench.controller.runCommand).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("focuses tab 9 on Alt+9 typed into a terminal", () => {
    // Given
    renderChords();
    const terminal = appendElement("div");
    terminal.className = "xterm";
    const terminalInput = appendElement("textarea", terminal);

    // When
    pressOn(terminalInput, { code: "Digit9", altKey: true });

    // Then
    expect(workbench.controller.runCommand).toHaveBeenCalledExactlyOnceWith({
      type: "focus-number",
      n: 9,
    });
  });

  it("focuses the adjacent group on Ctrl+Alt+ArrowLeft", () => {
    // Given
    renderChords();

    // When
    pressOn(window, { code: "ArrowLeft", ctrlKey: true, altKey: true });

    // Then
    expect(workbench.controller.runCommand).toHaveBeenCalledExactlyOnceWith({
      type: "focus-group",
      direction: "left",
    });
  });

  it("splits the focused group to the right on Ctrl+Shift+\\", () => {
    // Given
    renderChords();

    // When
    const event = pressOn(window, SPLIT_RIGHT);

    // Then
    expect(workbench.controller.runCommand).toHaveBeenCalledExactlyOnceWith({
      type: "split",
      direction: "right",
    });
    expect(event.defaultPrevented).toBe(true);
  });

  it("swallows a held Ctrl+Shift+\\ without splitting again", () => {
    // Given
    renderChords();

    // When
    const event = pressOn(window, { ...SPLIT_RIGHT, repeat: true });

    // Then
    expect(workbench.controller.runCommand).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });

  it("keeps a handled chord away from the focused terminal", () => {
    // Given
    renderChords();
    const terminal = appendElement("div");
    terminal.className = "xterm";
    const terminalInput = appendElement("textarea", terminal);
    const terminalKeyDown = vi.fn();
    terminalInput.addEventListener("keydown", terminalKeyDown);

    // When
    pressOn(terminalInput, NEXT_TAB);

    // Then
    expect(terminalKeyDown).not.toHaveBeenCalled();
    expect(workbench.controller.runCommand).toHaveBeenCalledOnce();
  });

  it("lets keys that are not chords through untouched", () => {
    // Given
    renderChords();
    const terminalInput = appendElement("textarea");
    const terminalKeyDown = vi.fn();
    terminalInput.addEventListener("keydown", terminalKeyDown);

    // When
    const event = pressOn(terminalInput, { code: "KeyA" });

    // Then
    expect(terminalKeyDown).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(false);
    expect(workbench.controller.runCommand).not.toHaveBeenCalled();
  });

  it("does nothing while workbench shortcuts are turned off", () => {
    // Given
    renderChords({ [SETTINGS_KEYS.WORKBENCH_CHORDS_ENABLED]: false });

    // When
    const event = pressOn(window, NEXT_TAB);

    // Then
    expect(workbench.controller.runCommand).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("stops listening once unmounted", () => {
    // Given
    const { unmount } = renderChords();
    unmount();

    // When
    const event = pressOn(window, NEXT_TAB);

    // Then
    expect(workbench.controller.runCommand).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });
});

describe("useWorkbenchChords context sidebar on desktop", () => {
  it.each([
    { chord: "Ctrl+\\", init: { code: "Backslash", ctrlKey: true } },
    { chord: "Cmd+\\", init: { code: "Backslash", metaKey: true } },
  ])("hides the open sidebar on $chord", ({ init }) => {
    // Given
    renderChords();

    // When
    const event = pressOn(window, init);

    // Then
    expect(useContextSidebarStore.getState().isOpen).toBe(false);
    expect(event.defaultPrevented).toBe(true);
  });

  it("shows the hidden sidebar again on the next press", () => {
    // Given
    renderChords();
    pressOn(window, { code: "Backslash", metaKey: true });

    // When
    pressOn(window, { code: "Backslash", metaKey: true });

    // Then
    expect(useContextSidebarStore.getState().isOpen).toBe(true);
  });

  it("toggles even when the focused element stops the key from bubbling", () => {
    // Given
    renderChords();
    const terminalInput = appendElement("textarea");
    terminalInput.addEventListener("keydown", (event) =>
      event.stopPropagation(),
    );

    // When
    pressOn(terminalInput, { code: "Backslash", ctrlKey: true });

    // Then
    expect(useContextSidebarStore.getState().isOpen).toBe(false);
  });

  it("swallows a held Ctrl+\\ without toggling again", () => {
    // Given
    renderChords();

    // When
    const event = pressOn(window, {
      code: "Backslash",
      ctrlKey: true,
      repeat: true,
    });

    // Then
    expect(useContextSidebarStore.getState().isOpen).toBe(true);
    expect(event.defaultPrevented).toBe(true);
  });

  it("leaves the sidebar alone on a tab chord", () => {
    // Given
    renderChords();

    // When
    pressOn(window, NEXT_TAB);

    // Then
    expect(useContextSidebarStore.getState().isOpen).toBe(true);
  });
});

describe("useWorkbenchChords context sidebar on a phone", () => {
  beforeEach(() => {
    vi.stubGlobal("innerWidth", 390);
  });

  it("opens the sheet instead of changing the desktop sidebar", () => {
    // Given
    renderChords();

    // When
    pressOn(window, { code: "Backslash", ctrlKey: true });

    // Then
    const state = useContextSidebarStore.getState();
    expect(state.isMobileSheetOpen).toBe(true);
    expect(state.isOpen).toBe(true);
  });

  it("closes the open sheet on the next press", () => {
    // Given
    renderChords();
    useContextSidebarStore.getState().setMobileSheetOpen(true);

    // When
    pressOn(window, { code: "Backslash", ctrlKey: true });

    // Then
    expect(useContextSidebarStore.getState().isMobileSheetOpen).toBe(false);
  });
});

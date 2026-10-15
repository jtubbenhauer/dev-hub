import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { FindInFilesShortcut } from "@/components/editor/find-in-files-shortcut";
import { useContentSearchStore } from "@/stores/content-search-store";

const push = vi.fn();
let currentPath = "/chat";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => currentPath,
}));

function renderWithPlatform(platform: string) {
  vi.spyOn(navigator, "platform", "get").mockReturnValue(platform);
  render(<FindInFilesShortcut />);
}

function pressKey(
  init: KeyboardEventInit,
  target: Element = document.body,
): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  fireEvent(target, event);
  return event;
}

function isSearchRequested(): boolean {
  return useContentSearchStore.getState().pendingFocus;
}

beforeEach(() => {
  currentPath = "/chat";
  push.mockClear();
  useContentSearchStore.setState({
    pattern: "",
    sidebarView: "explorer",
    pendingFocus: false,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  window.getSelection()?.removeAllRanges();
  document.body.innerHTML = "";
});

describe("find in files shortcut", () => {
  it("opens find in files with the selection on Cmd+Shift+F on macOS", () => {
    // Given
    renderWithPlatform("MacIntel");
    const selectedParagraph = document.createElement("p");
    selectedParagraph.textContent = "needle";
    document.body.appendChild(selectedParagraph);
    const range = document.createRange();
    range.selectNodeContents(selectedParagraph);
    window.getSelection()?.addRange(range);

    // When
    const event = pressKey({ key: "F", metaKey: true, shiftKey: true });

    // Then
    expect(isSearchRequested()).toBe(true);
    expect(useContentSearchStore.getState().pattern).toBe("needle");
    expect(push).toHaveBeenCalledWith("/files");
    expect(event.defaultPrevented).toBe(true);
  });

  it("ignores Ctrl+Shift+F on macOS", () => {
    // Given
    renderWithPlatform("MacIntel");

    // When
    const event = pressKey({ key: "F", ctrlKey: true, shiftKey: true });

    // Then
    expect(isSearchRequested()).toBe(false);
    expect(event.defaultPrevented).toBe(false);
  });

  it("opens find in files on Ctrl+Shift+F on other platforms", () => {
    // Given
    renderWithPlatform("Win32");

    // When
    pressKey({ key: "F", ctrlKey: true, shiftKey: true });

    // Then
    expect(isSearchRequested()).toBe(true);
  });

  it("ignores Cmd+F without shift", () => {
    // Given
    renderWithPlatform("MacIntel");

    // When
    const event = pressKey({ key: "f", metaKey: true });

    // Then
    expect(isSearchRequested()).toBe(false);
    expect(event.defaultPrevented).toBe(false);
  });

  it("fires before an element that stops keydown propagation", () => {
    // Given
    renderWithPlatform("MacIntel");
    const greedyElement = document.createElement("div");
    greedyElement.addEventListener("keydown", (e) => e.stopPropagation());
    document.body.appendChild(greedyElement);

    // When
    pressKey({ key: "F", metaKey: true, shiftKey: true }, greedyElement);

    // Then
    expect(isSearchRequested()).toBe(true);
  });
});

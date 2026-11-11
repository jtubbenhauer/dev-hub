import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  CommandPaletteProvider,
  useCommandPalette,
} from "@/components/providers/command-palette-provider";

function PaletteState() {
  const { isOpen } = useCommandPalette();
  return (
    <output aria-label="command palette">{isOpen ? "open" : "closed"}</output>
  );
}

function renderWithPlatform(platform: string) {
  vi.spyOn(navigator, "platform", "get").mockReturnValue(platform);
  render(
    <CommandPaletteProvider>
      <PaletteState />
      <div data-testid="editor" />
    </CommandPaletteProvider>,
  );
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

function paletteState(): string | null {
  return screen.getByLabelText("command palette").textContent;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("command palette shortcut", () => {
  it("opens the palette on Cmd+Shift+P on macOS and keeps the key from the page", () => {
    // Given
    renderWithPlatform("MacIntel");

    // When
    const event = pressKey({ key: "P", metaKey: true, shiftKey: true });

    // Then
    expect(paletteState()).toBe("open");
    expect(event.defaultPrevented).toBe(true);
  });

  it("matches the lowercase key macOS reports while Cmd is held", () => {
    // Given
    renderWithPlatform("MacIntel");

    // When
    pressKey({ key: "p", metaKey: true, shiftKey: true });

    // Then
    expect(paletteState()).toBe("open");
  });

  it("opens the palette on Ctrl+Shift+P on other platforms", () => {
    // Given
    renderWithPlatform("Win32");

    // When
    pressKey({ key: "P", ctrlKey: true, shiftKey: true });

    // Then
    expect(paletteState()).toBe("open");
  });

  it("leaves Ctrl+Shift+P alone on macOS", () => {
    // Given
    renderWithPlatform("MacIntel");

    // When
    const event = pressKey({ key: "P", ctrlKey: true, shiftKey: true });

    // Then
    expect(paletteState()).toBe("closed");
    expect(event.defaultPrevented).toBe(false);
  });

  it("leaves Cmd+P to the file picker", () => {
    // Given
    renderWithPlatform("MacIntel");

    // When
    const event = pressKey({ key: "p", metaKey: true });

    // Then
    expect(paletteState()).toBe("closed");
    expect(event.defaultPrevented).toBe(false);
  });

  it("still toggles the palette on Ctrl+,", () => {
    // Given
    renderWithPlatform("MacIntel");

    // When
    pressKey({ key: ",", ctrlKey: true });

    // Then
    expect(paletteState()).toBe("open");
  });

  it("closes an open palette on a second press", () => {
    // Given
    renderWithPlatform("MacIntel");
    pressKey({ key: "P", metaKey: true, shiftKey: true });

    // When
    pressKey({ key: "P", metaKey: true, shiftKey: true });

    // Then
    expect(paletteState()).toBe("closed");
  });

  it("ignores the auto-repeat of a held shortcut", () => {
    // Given
    renderWithPlatform("MacIntel");
    pressKey({ key: "P", metaKey: true, shiftKey: true });

    // When
    const event = pressKey({
      key: "P",
      metaKey: true,
      shiftKey: true,
      repeat: true,
    });

    // Then
    expect(paletteState()).toBe("open");
    expect(event.defaultPrevented).toBe(true);
  });

  it("opens even when the focused editor stops the key from bubbling", () => {
    // Given
    renderWithPlatform("MacIntel");
    const editor = screen.getByTestId("editor");
    editor.addEventListener("keydown", (event) => event.stopPropagation());

    // When
    pressKey({ key: "P", metaKey: true, shiftKey: true }, editor);

    // Then
    expect(paletteState()).toBe("open");
  });
});

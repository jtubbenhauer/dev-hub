import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  FilePickerProvider,
  useFilePicker,
} from "@/components/file-picker/file-picker";

function PickerState() {
  const { isOpen } = useFilePicker();
  return <output aria-label="file picker">{isOpen ? "open" : "closed"}</output>;
}

function renderWithPlatform(platform: string) {
  vi.spyOn(navigator, "platform", "get").mockReturnValue(platform);
  render(
    <FilePickerProvider>
      <PickerState />
    </FilePickerProvider>,
  );
}

function pressKey(init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  fireEvent(document.body, event);
  return event;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("file picker shortcut", () => {
  it("opens the picker and blocks the print dialog on Cmd+P on macOS", () => {
    // Given
    renderWithPlatform("MacIntel");

    // When
    const event = pressKey({ key: "p", metaKey: true });

    // Then
    expect(screen.getByLabelText("file picker")).toHaveTextContent("open");
    expect(event.defaultPrevented).toBe(true);
  });

  it("leaves Ctrl+P alone on macOS so text fields keep their line motion", () => {
    // Given
    renderWithPlatform("MacIntel");

    // When
    const event = pressKey({ key: "p", ctrlKey: true });

    // Then
    expect(screen.getByLabelText("file picker")).toHaveTextContent("closed");
    expect(event.defaultPrevented).toBe(false);
  });

  it("opens the picker on Ctrl+P on other platforms", () => {
    // Given
    renderWithPlatform("Win32");

    // When
    pressKey({ key: "p", ctrlKey: true });

    // Then
    expect(screen.getByLabelText("file picker")).toHaveTextContent("open");
  });

  it("ignores Cmd+Shift+P", () => {
    // Given
    renderWithPlatform("MacIntel");

    // When
    pressKey({ key: "P", metaKey: true, shiftKey: true });

    // Then
    expect(screen.getByLabelText("file picker")).toHaveTextContent("closed");
  });
});

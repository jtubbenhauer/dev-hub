import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearFocusedFileTabCommands,
  getFocusedFileTabCommands,
  setFocusedFileTabCommands,
  type FocusedFileTabCommands,
} from "@/lib/workbench/focused-file-tab-commands";

function commandsFor(tabId: string): FocusedFileTabCommands {
  return { tabId, save: vi.fn(), focusEditor: vi.fn() };
}

afterEach(() => {
  setFocusedFileTabCommands(null);
});

describe("focused file tab commands", () => {
  it("starts empty", () => {
    // Then
    expect(getFocusedFileTabCommands()).toBeNull();
  });

  it("hands out the commands the focused tab set", () => {
    // Given
    const commands = commandsFor("tab-a");

    // When
    setFocusedFileTabCommands(commands);

    // Then
    expect(getFocusedFileTabCommands()).toBe(commands);
  });

  it("clears the commands of the tab that set them", () => {
    // Given
    setFocusedFileTabCommands(commandsFor("tab-a"));

    // When
    clearFocusedFileTabCommands("tab-a");

    // Then
    expect(getFocusedFileTabCommands()).toBeNull();
  });

  it("keeps the newly focused tab's commands when the previous tab clears late", () => {
    // Given
    const nextCommands = commandsFor("tab-b");
    setFocusedFileTabCommands(commandsFor("tab-a"));
    setFocusedFileTabCommands(nextCommands);

    // When
    clearFocusedFileTabCommands("tab-a");

    // Then
    expect(getFocusedFileTabCommands()).toBe(nextCommands);
  });
});

// Page-wide `files:*` leader actions act on the focused file tab through this slot.
export interface FocusedFileTabCommands {
  readonly tabId: string;
  readonly save: () => void;
  readonly focusEditor: () => void;
}

let focusedFileTabCommands: FocusedFileTabCommands | null = null;

export function setFocusedFileTabCommands(
  commands: FocusedFileTabCommands | null,
): void {
  focusedFileTabCommands = commands;
}

export function getFocusedFileTabCommands(): FocusedFileTabCommands | null {
  return focusedFileTabCommands;
}

// A tab losing focus may clean up after the next tab already took the slot.
export function clearFocusedFileTabCommands(tabId: string): void {
  if (focusedFileTabCommands?.tabId === tabId) focusedFileTabCommands = null;
}

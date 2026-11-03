export type ChordKeyEvent = Pick<
  KeyboardEvent,
  | "code"
  | "ctrlKey"
  | "altKey"
  | "shiftKey"
  | "metaKey"
  | "isComposing"
  | "repeat"
>;

export type WorkbenchTabNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export type WorkbenchGroupDirection = "left" | "right" | "up" | "down";

export type WorkbenchChord =
  | { readonly type: "next-tab" }
  | { readonly type: "prev-tab" }
  | { readonly type: "focus-tab-number"; readonly number: WorkbenchTabNumber }
  | {
      readonly type: "focus-group";
      readonly direction: WorkbenchGroupDirection;
    }
  | { readonly type: "split-right" }
  | { readonly type: "toggle-context-sidebar" };

type ModifierSet = "ctrl+shift" | "alt" | "ctrl+alt" | "meta" | "ctrl";

const CTRL_SHIFT_CHORDS: ReadonlyMap<string, WorkbenchChord> = new Map([
  ["BracketRight", { type: "next-tab" }],
  ["BracketLeft", { type: "prev-tab" }],
  ["Backslash", { type: "split-right" }],
]);

const DIGIT_TAB_NUMBERS: ReadonlyMap<string, WorkbenchTabNumber> = new Map([
  ["Digit1", 1],
  ["Digit2", 2],
  ["Digit3", 3],
  ["Digit4", 4],
  ["Digit5", 5],
  ["Digit6", 6],
  ["Digit7", 7],
  ["Digit8", 8],
  ["Digit9", 9],
]);

const ARROW_GROUP_DIRECTIONS: ReadonlyMap<string, WorkbenchGroupDirection> =
  new Map([
    ["ArrowLeft", "left"],
    ["ArrowRight", "right"],
    ["ArrowUp", "up"],
    ["ArrowDown", "down"],
  ]);

const EDITABLE_INPUT_TYPES: ReadonlySet<string> = new Set([
  "text",
  "search",
  "url",
  "email",
  "tel",
  "password",
]);

const CHORD_CAPTURING_SURFACES = ".xterm, .monaco-editor";

function getModifierSet(event: ChordKeyEvent): ModifierSet | null {
  const { ctrlKey, altKey, shiftKey, metaKey } = event;
  if (ctrlKey && shiftKey && !altKey && !metaKey) return "ctrl+shift";
  if (altKey && !ctrlKey && !shiftKey && !metaKey) return "alt";
  if (ctrlKey && altKey && !shiftKey && !metaKey) return "ctrl+alt";
  if (metaKey && !ctrlKey && !altKey && !shiftKey) return "meta";
  if (ctrlKey && !metaKey && !altKey && !shiftKey) return "ctrl";
  return null;
}

function matchChordForModifierSet(
  modifierSet: ModifierSet,
  code: string,
): WorkbenchChord | null {
  switch (modifierSet) {
    case "ctrl+shift":
      return CTRL_SHIFT_CHORDS.get(code) ?? null;
    case "alt": {
      const tabNumber = DIGIT_TAB_NUMBERS.get(code);
      return tabNumber ? { type: "focus-tab-number", number: tabNumber } : null;
    }
    case "ctrl+alt": {
      const direction = ARROW_GROUP_DIRECTIONS.get(code);
      return direction ? { type: "focus-group", direction } : null;
    }
    case "meta":
    case "ctrl":
      return code === "Backslash" ? { type: "toggle-context-sidebar" } : null;
    default:
      return assertNeverModifierSet(modifierSet);
  }
}

function assertNeverModifierSet(modifierSet: never): never {
  throw new Error(`unhandled modifier set: ${String(modifierSet)}`);
}

function isRepeatableChord(chord: WorkbenchChord): boolean {
  switch (chord.type) {
    case "next-tab":
    case "prev-tab":
    case "focus-tab-number":
    case "focus-group":
      return true;
    case "split-right":
    case "toggle-context-sidebar":
      return false;
    default:
      return assertNeverChord(chord);
  }
}

function assertNeverChord(chord: never): never {
  throw new Error(`unhandled workbench chord: ${JSON.stringify(chord)}`);
}

export function matchWorkbenchChord(
  event: ChordKeyEvent,
): WorkbenchChord | null {
  if (event.isComposing) return null;
  const modifierSet = getModifierSet(event);
  if (!modifierSet) return null;
  const chord = matchChordForModifierSet(modifierSet, event.code);
  if (!chord) return null;
  if (event.repeat && !isRepeatableChord(chord)) return null;
  return chord;
}

export function isEditableChordTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.closest(CHORD_CAPTURING_SURFACES)) return false;
  if (target instanceof HTMLInputElement) {
    return EDITABLE_INPUT_TYPES.has(target.type);
  }
  if (target instanceof HTMLTextAreaElement) return true;
  // jsdom leaves isContentEditable undefined; browsers always report a boolean.
  return target.isContentEditable === true;
}

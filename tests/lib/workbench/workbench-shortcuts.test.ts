import { afterEach, describe, expect, it } from "vitest";
import {
  isEditableChordTarget,
  matchWorkbenchChord,
  type ChordKeyEvent,
} from "@/lib/workbench/workbench-shortcuts";

type ModifierName = "ctrl" | "alt" | "shift" | "meta";

function chordEvent(
  code: string,
  modifiers: readonly ModifierName[] = [],
  overrides: Partial<ChordKeyEvent> = {},
): ChordKeyEvent {
  return {
    code,
    ctrlKey: modifiers.includes("ctrl"),
    altKey: modifiers.includes("alt"),
    shiftKey: modifiers.includes("shift"),
    metaKey: modifiers.includes("meta"),
    isComposing: false,
    repeat: false,
    ...overrides,
  };
}

describe("matchWorkbenchChord", () => {
  describe("ctrl+shift chords", () => {
    it("returns next-tab for Ctrl+Shift+BracketRight", () => {
      expect(
        matchWorkbenchChord(chordEvent("BracketRight", ["ctrl", "shift"])),
      ).toEqual({ type: "next-tab" });
    });

    it("returns prev-tab for Ctrl+Shift+BracketLeft", () => {
      expect(
        matchWorkbenchChord(chordEvent("BracketLeft", ["ctrl", "shift"])),
      ).toEqual({ type: "prev-tab" });
    });

    it("returns split-right for Ctrl+Shift+Backslash", () => {
      expect(
        matchWorkbenchChord(chordEvent("Backslash", ["ctrl", "shift"])),
      ).toEqual({ type: "split-right" });
    });

    it("returns null for Ctrl+BracketRight without shift", () => {
      expect(matchWorkbenchChord(chordEvent("BracketRight", ["ctrl"]))).toBe(
        null,
      );
    });

    it("returns null for Meta+Shift+BracketRight", () => {
      expect(
        matchWorkbenchChord(chordEvent("BracketRight", ["meta", "shift"])),
      ).toBe(null);
    });

    it("returns null for Ctrl+Shift+Meta+BracketRight", () => {
      expect(
        matchWorkbenchChord(
          chordEvent("BracketRight", ["ctrl", "shift", "meta"]),
        ),
      ).toBe(null);
    });

    it("returns null for Ctrl+Shift+Alt+BracketLeft", () => {
      expect(
        matchWorkbenchChord(
          chordEvent("BracketLeft", ["ctrl", "shift", "alt"]),
        ),
      ).toBe(null);
    });

    it("returns null for plain BracketRight", () => {
      expect(matchWorkbenchChord(chordEvent("BracketRight"))).toBe(null);
    });

    it("returns null for Ctrl+Shift+BracketRight while composing", () => {
      expect(
        matchWorkbenchChord(
          chordEvent("BracketRight", ["ctrl", "shift"], { isComposing: true }),
        ),
      ).toBe(null);
    });

    it("returns null for an unrelated code with Ctrl+Shift", () => {
      expect(matchWorkbenchChord(chordEvent("KeyF", ["ctrl", "shift"]))).toBe(
        null,
      );
    });
  });

  describe("alt+digit chords", () => {
    it.each([1, 2, 3, 4, 5, 6, 7, 8, 9])(
      "returns focus-tab-number %i for Alt+Digit%i",
      (tabNumber) => {
        expect(
          matchWorkbenchChord(chordEvent(`Digit${tabNumber}`, ["alt"])),
        ).toEqual({ type: "focus-tab-number", number: tabNumber });
      },
    );

    it("returns null for Alt+Digit0", () => {
      expect(matchWorkbenchChord(chordEvent("Digit0", ["alt"]))).toBe(null);
    });

    it("returns null for Alt+Numpad1", () => {
      expect(matchWorkbenchChord(chordEvent("Numpad1", ["alt"]))).toBe(null);
    });

    it("returns null for Alt+Shift+Digit1", () => {
      expect(matchWorkbenchChord(chordEvent("Digit1", ["alt", "shift"]))).toBe(
        null,
      );
    });

    it("returns null for Cmd+Digit1 (browser-reserved)", () => {
      expect(matchWorkbenchChord(chordEvent("Digit1", ["meta"]))).toBe(null);
    });

    it("returns null for Ctrl+Digit1", () => {
      expect(matchWorkbenchChord(chordEvent("Digit1", ["ctrl"]))).toBe(null);
    });

    it("returns null for Alt+Meta+Digit1", () => {
      expect(matchWorkbenchChord(chordEvent("Digit1", ["alt", "meta"]))).toBe(
        null,
      );
    });

    it("returns null for plain Digit1", () => {
      expect(matchWorkbenchChord(chordEvent("Digit1"))).toBe(null);
    });

    it("still matches on a repeat event", () => {
      expect(
        matchWorkbenchChord(chordEvent("Digit3", ["alt"], { repeat: true })),
      ).toEqual({ type: "focus-tab-number", number: 3 });
    });
  });

  describe("ctrl+alt arrow chords", () => {
    it.each([
      ["ArrowLeft", "left"],
      ["ArrowRight", "right"],
      ["ArrowUp", "up"],
      ["ArrowDown", "down"],
    ] as const)("returns focus-group for Ctrl+Alt+%s", (code, direction) => {
      expect(matchWorkbenchChord(chordEvent(code, ["ctrl", "alt"]))).toEqual({
        type: "focus-group",
        direction,
      });
    });

    it("returns null for Ctrl+Alt+Shift+ArrowLeft", () => {
      expect(
        matchWorkbenchChord(chordEvent("ArrowLeft", ["ctrl", "alt", "shift"])),
      ).toBe(null);
    });

    it("returns null for Ctrl+Alt+Meta+ArrowRight", () => {
      expect(
        matchWorkbenchChord(chordEvent("ArrowRight", ["ctrl", "alt", "meta"])),
      ).toBe(null);
    });

    it("returns null for Alt+ArrowLeft without ctrl", () => {
      expect(matchWorkbenchChord(chordEvent("ArrowLeft", ["alt"]))).toBe(null);
    });

    it("returns null for Ctrl+ArrowLeft without alt", () => {
      expect(matchWorkbenchChord(chordEvent("ArrowLeft", ["ctrl"]))).toBe(null);
    });
  });

  describe("context sidebar toggle", () => {
    it("returns toggle-context-sidebar for Meta+Backslash", () => {
      expect(matchWorkbenchChord(chordEvent("Backslash", ["meta"]))).toEqual({
        type: "toggle-context-sidebar",
      });
    });

    it("returns toggle-context-sidebar for Ctrl+Backslash", () => {
      expect(matchWorkbenchChord(chordEvent("Backslash", ["ctrl"]))).toEqual({
        type: "toggle-context-sidebar",
      });
    });

    it("returns null for Meta+Shift+Backslash", () => {
      expect(
        matchWorkbenchChord(chordEvent("Backslash", ["meta", "shift"])),
      ).toBe(null);
    });

    it("returns null for Ctrl+Meta+Backslash", () => {
      expect(
        matchWorkbenchChord(chordEvent("Backslash", ["ctrl", "meta"])),
      ).toBe(null);
    });

    it("returns null for Meta+Alt+Backslash", () => {
      expect(
        matchWorkbenchChord(chordEvent("Backslash", ["meta", "alt"])),
      ).toBe(null);
    });

    it("returns null for plain Backslash", () => {
      expect(matchWorkbenchChord(chordEvent("Backslash"))).toBe(null);
    });
  });

  describe("repeat events", () => {
    it("matches next-tab on repeat so holding the chord keeps cycling", () => {
      expect(
        matchWorkbenchChord(
          chordEvent("BracketRight", ["ctrl", "shift"], { repeat: true }),
        ),
      ).toEqual({ type: "next-tab" });
    });

    it("matches focus-group on repeat", () => {
      expect(
        matchWorkbenchChord(
          chordEvent("ArrowDown", ["ctrl", "alt"], { repeat: true }),
        ),
      ).toEqual({ type: "focus-group", direction: "down" });
    });

    it("returns null for split-right on repeat", () => {
      expect(
        matchWorkbenchChord(
          chordEvent("Backslash", ["ctrl", "shift"], { repeat: true }),
        ),
      ).toBe(null);
    });

    it("returns null for toggle-context-sidebar on repeat", () => {
      expect(
        matchWorkbenchChord(
          chordEvent("Backslash", ["meta"], { repeat: true }),
        ),
      ).toBe(null);
    });
  });

  describe("browser-reserved keys", () => {
    it.each([
      ["Cmd+W", chordEvent("KeyW", ["meta"])],
      ["Cmd+T", chordEvent("KeyT", ["meta"])],
      ["Cmd+N", chordEvent("KeyN", ["meta"])],
      ["Ctrl+W", chordEvent("KeyW", ["ctrl"])],
      ["Ctrl+Tab", chordEvent("Tab", ["ctrl"])],
      ["Ctrl+Shift+Tab", chordEvent("Tab", ["ctrl", "shift"])],
      ["Cmd+9", chordEvent("Digit9", ["meta"])],
    ])("returns null for %s", (_label, event) => {
      expect(matchWorkbenchChord(event)).toBe(null);
    });
  });

  it("matches on code, not on the produced key", () => {
    const optionDigitOnMac = {
      ...chordEvent("Digit2", ["alt"]),
      key: "™",
    };
    expect(matchWorkbenchChord(optionDigitOnMac)).toEqual({
      type: "focus-tab-number",
      number: 2,
    });
  });
});

describe("isEditableChordTarget", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  function mount<T extends Element>(markup: string, selector: string): T {
    document.body.innerHTML = markup;
    const element = document.querySelector<T>(selector);
    if (!element) throw new Error(`no element for ${selector}`);
    return element;
  }

  it("returns true for a plain textarea", () => {
    expect(
      isEditableChordTarget(mount("<textarea></textarea>", "textarea")),
    ).toBe(true);
  });

  it("returns true for an input with no type attribute", () => {
    expect(isEditableChordTarget(mount("<input />", "input"))).toBe(true);
  });

  it.each(["text", "search", "url", "email", "tel", "password"])(
    "returns true for input[type=%s]",
    (inputType) => {
      expect(
        isEditableChordTarget(mount(`<input type="${inputType}" />`, "input")),
      ).toBe(true);
    },
  );

  it("returns true for an input with an unknown type attribute (reports text)", () => {
    expect(
      isEditableChordTarget(mount('<input type="bogus" />', "input")),
    ).toBe(true);
  });

  it("returns false for input[type=checkbox]", () => {
    expect(
      isEditableChordTarget(mount('<input type="checkbox" />', "input")),
    ).toBe(false);
  });

  it("returns false for input[type=number]", () => {
    expect(
      isEditableChordTarget(mount('<input type="number" />', "input")),
    ).toBe(false);
  });

  it("returns false for the xterm helper textarea inside div.xterm", () => {
    expect(
      isEditableChordTarget(
        mount(
          '<div class="xterm"><textarea class="xterm-helper-textarea"></textarea></div>',
          "textarea",
        ),
      ),
    ).toBe(false);
  });

  it("returns false for a textarea inside div.monaco-editor", () => {
    expect(
      isEditableChordTarget(
        mount(
          '<div class="monaco-editor"><div><textarea></textarea></div></div>',
          "textarea",
        ),
      ),
    ).toBe(false);
  });

  it("returns false for a plain div", () => {
    expect(isEditableChordTarget(mount("<div></div>", "div"))).toBe(false);
  });

  it("returns true for a contenteditable element", () => {
    const editable = mount<HTMLDivElement>(
      '<div contenteditable="true"></div>',
      "div",
    );
    // jsdom does not implement isContentEditable, so stub what browsers report.
    Object.defineProperty(editable, "isContentEditable", { value: true });
    expect(isEditableChordTarget(editable)).toBe(true);
  });

  it("returns false for null", () => {
    expect(isEditableChordTarget(null)).toBe(false);
  });

  it("returns false for the window target", () => {
    expect(isEditableChordTarget(window)).toBe(false);
  });
});

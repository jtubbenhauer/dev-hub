import { describe, expect, it } from "vitest";
import {
  SESSION_TITLE_MAX_CHARS,
  titleFromUserText,
} from "@/lib/session-title/title-text";

describe("titleFromUserText", () => {
  it("drops injected context blocks and collapses whitespace", () => {
    expect(
      titleFromUserText("Context files:\n- a.ts\n\nFix the   login\nbug"),
    ).toBe("Fix the login bug");
  });

  it("caps the title length", () => {
    expect(titleFromUserText("word ".repeat(40))?.length).toBeLessThanOrEqual(
      SESSION_TITLE_MAX_CHARS,
    );
  });

  it("returns null when only injected context remains", () => {
    expect(titleFromUserText("Context files:\n- a.ts")).toBeNull();
  });
});

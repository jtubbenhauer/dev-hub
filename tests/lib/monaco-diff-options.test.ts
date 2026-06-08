import { describe, expect, it } from "vitest";
import { WRAPPED_DIFF_EDITOR_OPTIONS } from "@/lib/editor/monaco-diff-options";

describe("WRAPPED_DIFF_EDITOR_OPTIONS", () => {
  it("enables diff-level wrapping", () => {
    expect(WRAPPED_DIFF_EDITOR_OPTIONS.diffWordWrap).toBe("on");
    expect(WRAPPED_DIFF_EDITOR_OPTIONS.wordWrap).toBe("on");
  });

  it("forces wrapping on both original and modified panes", () => {
    expect(WRAPPED_DIFF_EDITOR_OPTIONS.wordWrapOverride1).toBe("on");
    expect(WRAPPED_DIFF_EDITOR_OPTIONS.wordWrapOverride2).toBe("on");
  });
});

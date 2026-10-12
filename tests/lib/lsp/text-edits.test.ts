// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  applyLspContentChanges,
  applyLspTextEdits,
} from "@/lib/lsp/text-edits";
import { isLspWorkspaceEdit, type LspRange } from "@/lib/lsp/types";

const range = (start: number, end = start): LspRange => ({
  start: { line: 0, character: start },
  end: { line: 0, character: end },
});

describe("text edits", () => {
  it("keeps insertion order when starts are identical", () => {
    const edits = ["a", "b", "c"].map((newText) => ({
      range: range(1),
      newText,
    }));
    const result = applyLspTextEdits("xy", edits);
    expect(result).toBe("xabcy");
  });
  it("uses UTF-16 offsets when text contains surrogate pairs", () => {
    const result = applyLspTextEdits("a😀b", [
      { range: range(1, 3), newText: "X" },
    ]);
    expect(result).toBe("aXb");
  });
  it("keeps CR when lines use CRLF", () => {
    const result = applyLspTextEdits("ab\r\ncd", [
      { range: range(2, 3), newText: "!" },
    ]);
    expect(result).toBe("ab!\ncd");
  });
  it("throws when ranges overlap", () => {
    const edits = [
      { range: range(0, 2), newText: "x" },
      { range: range(1, 3), newText: "y" },
    ];
    expect(() => applyLspTextEdits("abcd", edits)).toThrow(
      "overlapping text edits",
    );
  });
  it("clamps positions when they exceed a line or document", () => {
    const result = applyLspTextEdits("ab\nc", [
      {
        range: {
          start: { line: 0, character: 99 },
          end: { line: 99, character: 99 },
        },
        newText: "!",
      },
    ]);
    expect(result).toBe("ab!");
  });
  it("applies sequential changes when full and incremental updates mix", () => {
    const result = applyLspContentChanges("old", [
      { text: "abc" },
      { range: range(1, 2), text: "XY" },
      { range: range(3, 4), text: "!" },
    ]);
    expect(result).toBe("aXY!");
  });
});

describe("workspace edit guard", () => {
  it.each([
    null,
    [],
    { changes: [] },
    { changes: { x: [{}] } },
    {
      documentChanges: [
        { kind: "create", uri: "x", options: { overwrite: "yes" } },
      ],
    },
    { documentChanges: [{ textDocument: { uri: "x" }, edits: [] }] },
  ])("refuses malformed edit %j", (edit) => {
    expect(isLspWorkspaceEdit(edit)).toBe(false);
  });
  it("accepts structural resource operations and versioned edits", () => {
    const edit = {
      documentChanges: [
        { kind: "create", uri: "x" },
        {
          textDocument: { uri: "x", version: null },
          edits: [{ range: range(0), newText: "x" }],
        },
        { kind: "rename", oldUri: "x", newUri: "y" },
        { kind: "delete", uri: "y" },
      ],
    };
    expect(isLspWorkspaceEdit(edit)).toBe(true);
  });
});

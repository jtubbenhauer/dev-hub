import { describe, expect, it } from "vitest";
import {
  fingerprintText,
  isSearchMatchCurrent,
  type ContentSearchMatch,
} from "@devhub/shared";

interface MatchLocation {
  readonly line: string;
  readonly lineNumber: number;
  readonly startColumn: number;
  readonly endColumn: number;
}

function makeMatch(location: MatchLocation): ContentSearchMatch {
  const { line, lineNumber, startColumn, endColumn } = location;
  const isZeroLength = endColumn === startColumn;
  const matchedText = isZeroLength
    ? line
    : line.slice(startColumn - 1, endColumn - 1);
  return {
    lineNumber,
    startColumn,
    endColumn,
    startByteColumn: startColumn,
    matchFingerprint: fingerprintText(matchedText),
    lineSha256: "0".repeat(64),
    preview: line,
    previewMatchStart: startColumn - 1,
    previewMatchEnd: endColumn - 1,
  };
}

describe("fingerprintText", () => {
  it("matches the published FNV-1a 32-bit vectors", () => {
    expect(fingerprintText("")).toBe("0:811c9dc5");
    expect(fingerprintText("a")).toBe("1:e40c292c");
    expect(fingerprintText("foobar")).toBe("6:bf9cf968");
  });

  it("prefixes the text length", () => {
    const text = "hello world";

    expect(fingerprintText(text).startsWith(`${text.length}:`)).toBe(true);
  });

  it("is equal for equal strings", () => {
    expect(fingerprintText("const value")).toBe(
      fingerprintText(["const", "value"].join(" ")),
    );
  });

  it("differs for strings that differ in one character", () => {
    expect(fingerprintText("value")).not.toBe(fingerprintText("valve"));
  });

  it("differs for strings that differ in one character after the 200th", () => {
    const original = "x".repeat(300);
    const changed = `${original.slice(0, 250)}y${original.slice(251)}`;

    expect(changed).toHaveLength(original.length);
    expect(fingerprintText(changed)).not.toBe(fingerprintText(original));
  });

  it("differs for strings that differ only in length", () => {
    expect(fingerprintText("ab")).not.toBe(fingerprintText("ab\u0000"));
    expect(fingerprintText("x".repeat(10))).not.toBe(
      fingerprintText("x".repeat(11)),
    );
  });
});

describe("isSearchMatchCurrent", () => {
  const targetLine = "const value = 1;";
  const valueColumn = targetLine.indexOf("value") + 1;
  const valueMatch = makeMatch({
    line: targetLine,
    lineNumber: 2,
    startColumn: valueColumn,
    endColumn: valueColumn + "value".length,
  });

  it("is true when the content still has the match (LF)", () => {
    const content = ["first", targetLine, "last"].join("\n");

    expect(isSearchMatchCurrent(content, valueMatch)).toBe(true);
  });

  it("is true when the content still has the match (CRLF)", () => {
    const content = ["first", targetLine, "last"].join("\r\n");

    expect(isSearchMatchCurrent(content, valueMatch)).toBe(true);
  });

  it("is true for a match ending at the end of a CRLF line", () => {
    const match = makeMatch({
      line: targetLine,
      lineNumber: 2,
      startColumn: targetLine.length,
      endColumn: targetLine.length + 1,
    });
    const content = ["first", targetLine, "last"].join("\r\n");

    expect(isSearchMatchCurrent(content, match)).toBe(true);
  });

  it("is false when the line moved", () => {
    const content = ["first", "inserted", targetLine, "last"].join("\n");

    expect(isSearchMatchCurrent(content, valueMatch)).toBe(false);
  });

  it("is false when the line no longer exists", () => {
    expect(isSearchMatchCurrent("first", valueMatch)).toBe(false);
  });

  it("is false when the line is now shorter than the match end", () => {
    const content = ["first", "const val"].join("\n");

    expect(isSearchMatchCurrent(content, valueMatch)).toBe(false);
  });

  it("is false when the text at the column changed", () => {
    const content = ["first", "const other = 1;", "last"].join("\n");

    expect(isSearchMatchCurrent(content, valueMatch)).toBe(false);
  });

  it("is false when a 500-char match changed only at character 400", () => {
    const longLine = "a".repeat(500);
    const match = makeMatch({
      line: longLine,
      lineNumber: 1,
      startColumn: 1,
      endColumn: longLine.length + 1,
    });
    const changedLine = `${longLine.slice(0, 399)}b${longLine.slice(400)}`;

    expect(isSearchMatchCurrent(longLine, match)).toBe(true);
    expect(isSearchMatchCurrent(changedLine, match)).toBe(false);
  });

  it("is true for a zero-length match when the whole line is unchanged", () => {
    const match = makeMatch({
      line: targetLine,
      lineNumber: 1,
      startColumn: 1,
      endColumn: 1,
    });

    expect(isSearchMatchCurrent(`${targetLine}\nnext`, match)).toBe(true);
  });

  it("is false for a zero-length match when the line changed elsewhere", () => {
    const match = makeMatch({
      line: targetLine,
      lineNumber: 1,
      startColumn: 1,
      endColumn: 1,
    });
    const changedLine = targetLine.replace("1", "2");

    expect(changedLine).not.toBe(targetLine);
    expect(isSearchMatchCurrent(changedLine, match)).toBe(false);
  });
});

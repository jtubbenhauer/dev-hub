import { describe, expect, it } from "vitest";
import {
  buildMatch,
  stripLineEnding,
  utf16ToUtf8ByteLength,
  utf8ByteOffsetToUtf16,
} from "@/packages/shared/src/content-search/preview";
import {
  fingerprintText,
  isSearchMatchCurrent,
} from "@/packages/shared/src/content-search/verify";

const LINE_SHA = "f".repeat(64);

function matchAt(line: string, start: number, end: number) {
  return buildMatch({ line, lineNumber: 1, start, end, lineSha256: LINE_SHA });
}

describe("utf16ToUtf8ByteLength", () => {
  it("counts UTF-8 bytes of ASCII, accented and astral text", () => {
    expect(utf16ToUtf8ByteLength("abc")).toBe(3);
    expect(utf16ToUtf8ByteLength("café")).toBe(5);
    expect(utf16ToUtf8ByteLength("😀")).toBe(4);
    expect(utf16ToUtf8ByteLength("")).toBe(0);
  });
});

describe("utf8ByteOffsetToUtf16", () => {
  it("maps a byte offset after multi-byte characters to a UTF-16 offset", () => {
    const line = 'const café = "naïve needle";';
    const byteOffset = Buffer.byteLength(line.slice(0, line.indexOf("needle")));

    expect(utf8ByteOffsetToUtf16(line, byteOffset)).toBe(
      line.indexOf("needle"),
    );
  });

  it("counts an astral character as two UTF-16 units", () => {
    expect(utf8ByteOffsetToUtf16("😀x", 4)).toBe(2);
  });

  it("keeps a leading byte-order mark in the count", () => {
    const line = "\uFEFFneedle";
    expect(utf8ByteOffsetToUtf16(line, 3)).toBe(1);
  });
});

describe("stripLineEnding", () => {
  it("removes a trailing CRLF", () => {
    expect(stripLineEnding("text\r\n")).toBe("text");
  });

  it("removes a trailing LF", () => {
    expect(stripLineEnding("text\n")).toBe("text");
  });

  it("leaves text without a trailing newline unchanged", () => {
    expect(stripLineEnding("text")).toBe("text");
    expect(stripLineEnding("text\r")).toBe("text\r");
  });

  it("removes only one line ending", () => {
    expect(stripLineEnding("a\r\nb\n\n")).toBe("a\r\nb\n");
  });
});

describe("buildMatch", () => {
  it("reports UTF-16 and UTF-8 byte columns when non-ASCII text precedes the match", () => {
    const line = 'const café = "naïve needle";';
    const start = line.indexOf("needle");
    const end = start + "needle".length;

    const match = matchAt(line, start, end);

    expect(match).toEqual({
      lineNumber: 1,
      startColumn: start + 1,
      endColumn: end + 1,
      startByteColumn: Buffer.byteLength(line.slice(0, start)) + 1,
      matchFingerprint: fingerprintText("needle"),
      lineSha256: LINE_SHA,
      preview: line,
      previewMatchStart: start,
      previewMatchEnd: end,
    });
    expect(isSearchMatchCurrent(line, match)).toBe(true);
  });

  it("builds a match for a CRLF line after stripping the line ending", () => {
    const rawLine = "let value = needle;\r\n";
    const line = stripLineEnding(rawLine);
    const start = line.indexOf("needle");

    const match = buildMatch({
      line,
      lineNumber: 2,
      start,
      end: start + 6,
      lineSha256: LINE_SHA,
    });

    expect(match.preview).toBe("let value = needle;");
    expect(isSearchMatchCurrent(`first\r\n${rawLine}`, match)).toBe(true);
  });

  it("trims leading spaces and tabs from a short preview and shifts the offsets", () => {
    const line = "\t  \treturn needle;";
    const start = line.indexOf("needle");

    const match = matchAt(line, start, start + 6);

    expect(match.preview).toBe("return needle;");
    expect(match.previewMatchStart).toBe(start - 4);
    expect(match.previewMatchEnd).toBe(start + 2);
    expect(match.startColumn).toBe(start + 1);
    expect(isSearchMatchCurrent(line, match)).toBe(true);
  });

  it("clamps preview offsets of a match inside the trimmed indentation to zero", () => {
    const line = "    code";

    const match = matchAt(line, 1, 3);

    expect(match.preview).toBe("code");
    expect(match.previewMatchStart).toBe(0);
    expect(match.previewMatchEnd).toBe(0);
    expect(isSearchMatchCurrent(line, match)).toBe(true);
  });

  it("windows a 1,000-char minified line with ellipses on both sides", () => {
    const line = "x".repeat(500) + "needle" + "y".repeat(494);
    const start = 500;

    const match = matchAt(line, start, start + 6);

    expect(line.length).toBe(1000);
    expect(match.preview).toBe(`…${line.slice(460, 660)}…`);
    expect(match.preview.length).toBe(202);
    expect(match.previewMatchStart).toBe(41);
    expect(match.previewMatchEnd).toBe(47);
    expect(
      match.preview.slice(match.previewMatchStart, match.previewMatchEnd),
    ).toBe("needle");
    expect(match.startColumn).toBe(501);
    expect(isSearchMatchCurrent(line, match)).toBe(true);
  });

  it("omits the leading ellipsis when the match is near the start of a long line", () => {
    const line = "ab" + "needle" + "z".repeat(992);

    const match = matchAt(line, 2, 8);

    expect(match.preview).toBe(`${line.slice(0, 200)}…`);
    expect(match.previewMatchStart).toBe(2);
    expect(match.previewMatchEnd).toBe(8);
    expect(isSearchMatchCurrent(line, match)).toBe(true);
  });

  it("omits the trailing ellipsis when the window reaches the end of a long line", () => {
    const line = "z".repeat(994) + "needle";

    const match = matchAt(line, 994, 1000);

    expect(match.preview).toBe(`…${line.slice(954)}`);
    expect(match.previewMatchStart).toBe(41);
    expect(match.previewMatchEnd).toBe(47);
    expect(isSearchMatchCurrent(line, match)).toBe(true);
  });

  it("fingerprints a 500-char match on the full line and clamps the preview end", () => {
    const line = "a".repeat(100) + "b".repeat(500) + "c".repeat(400);

    const match = matchAt(line, 100, 600);

    expect(match.matchFingerprint).toBe(fingerprintText("b".repeat(500)));
    expect(match.preview.length).toBe(202);
    expect(match.previewMatchStart).toBe(41);
    expect(match.previewMatchEnd).toBe(202);
    expect(match.endColumn).toBe(601);
    expect(isSearchMatchCurrent(line, match)).toBe(true);
  });

  it("fingerprints the whole line for a zero-length match", () => {
    const line = "  indented text";

    const match = matchAt(line, 0, 0);

    expect(match.matchFingerprint).toBe(fingerprintText(line));
    expect(match.startColumn).toBe(1);
    expect(match.endColumn).toBe(1);
    expect(isSearchMatchCurrent(line, match)).toBe(true);
  });

  it("copies lineSha256 unchanged", () => {
    const lineSha256 =
      "795c238dcce900c0131e710c25229cc164f8c22b48bb0d5ea3343ad340d91bc4";

    const match = buildMatch({
      line: "a needle here",
      lineNumber: 7,
      start: 2,
      end: 8,
      lineSha256,
    });

    expect(match.lineSha256).toBe(lineSha256);
    expect(match.lineNumber).toBe(7);
  });
});

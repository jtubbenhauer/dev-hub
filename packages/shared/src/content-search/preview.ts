import type { ContentSearchMatch } from "./types";
import { fingerprintText } from "./verify";

// Pure TypeScript: no Node imports, so it can be exported to client bundles.

const PREVIEW_MAX_CHARS = 200;
const PREVIEW_CHARS_BEFORE_MATCH = 40;
const ELLIPSIS = "…";
const LEADING_SPACES_AND_TABS = /^[ \t]+/;

const utf8Encoder = new TextEncoder();
// ignoreBOM keeps a leading U+FEFF in the output so offsets stay aligned.
const utf8Decoder = new TextDecoder("utf-8", { ignoreBOM: true });

export function utf16ToUtf8ByteLength(text: string): number {
  return utf8Encoder.encode(text).length;
}

export function utf8ByteOffsetToUtf16(
  line: string,
  byteOffset: number,
): number {
  const bytesBeforeOffset = utf8Encoder.encode(line).subarray(0, byteOffset);
  return utf8Decoder.decode(bytesBeforeOffset).length;
}

export function stripLineEnding(text: string): string {
  if (!text.endsWith("\n")) return text;
  const withoutNewline = text.slice(0, -1);
  return withoutNewline.endsWith("\r")
    ? withoutNewline.slice(0, -1)
    : withoutNewline;
}

export interface BuildMatchInput {
  readonly line: string;
  readonly lineNumber: number;
  // UTF-16 offsets into the full line; end is exclusive.
  readonly start: number;
  readonly end: number;
  readonly lineSha256: string;
}

interface MatchPreview {
  readonly preview: string;
  readonly previewMatchStart: number;
  readonly previewMatchEnd: number;
}

function buildPreview(line: string, start: number, end: number): MatchPreview {
  if (line.length <= PREVIEW_MAX_CHARS) {
    const preview = line.replace(LEADING_SPACES_AND_TABS, "");
    const trimmedLength = line.length - preview.length;
    return {
      preview,
      previewMatchStart: Math.max(0, start - trimmedLength),
      previewMatchEnd: Math.max(0, end - trimmedLength),
    };
  }

  const windowStart = Math.max(0, start - PREVIEW_CHARS_BEFORE_MATCH);
  const windowEnd = Math.min(line.length, windowStart + PREVIEW_MAX_CHARS);
  const prefix = windowStart > 0 ? ELLIPSIS : "";
  const suffix = windowEnd < line.length ? ELLIPSIS : "";
  const preview = prefix + line.slice(windowStart, windowEnd) + suffix;
  const lineToPreviewShift = prefix.length - windowStart;
  return {
    preview,
    previewMatchStart: start + lineToPreviewShift,
    previewMatchEnd: Math.min(preview.length, end + lineToPreviewShift),
  };
}

export function buildMatch(input: BuildMatchInput): ContentSearchMatch {
  const { line, lineNumber, start, end, lineSha256 } = input;
  const matchFingerprint =
    end > start
      ? fingerprintText(line.slice(start, end))
      : fingerprintText(line);
  return {
    lineNumber,
    startColumn: start + 1,
    endColumn: end + 1,
    startByteColumn: utf16ToUtf8ByteLength(line.slice(0, start)) + 1,
    matchFingerprint,
    lineSha256,
    ...buildPreview(line, start, end),
  };
}

import { describe, expect, it } from "vitest";
import {
  parseContentSearchOutcome,
  type ContentSearchMatch,
  type ContentSearchOutcome,
} from "@devhub/shared";

const validMatch: ContentSearchMatch = {
  lineNumber: 3,
  startColumn: 5,
  endColumn: 11,
  startByteColumn: 5,
  matchFingerprint: "6:bf9cf968",
  lineSha256: "0".repeat(64),
  preview: "    foobar();",
  previewMatchStart: 4,
  previewMatchEnd: 10,
};

const validOkOutcome: ContentSearchOutcome = {
  kind: "ok",
  files: [
    { path: "src/index.ts", matches: [validMatch] },
    { path: "README.md", matches: [] },
  ],
  matchCount: 1,
  fileCount: 2,
  isLimitHit: false,
  isTimedOut: true,
  engine: "ripgrep",
  durationMs: 12.5,
};

function okWithMatch(matchOverrides: Record<string, unknown>): unknown {
  return {
    ...validOkOutcome,
    files: [
      { path: "src/index.ts", matches: [{ ...validMatch, ...matchOverrides }] },
    ],
  };
}

function okWithout(field: string): unknown {
  return Object.fromEntries(
    Object.entries(validOkOutcome).filter(([key]) => key !== field),
  );
}

function matchWithout(field: string): unknown {
  const match = Object.fromEntries(
    Object.entries(validMatch).filter(([key]) => key !== field),
  );
  return { ...validOkOutcome, files: [{ path: "a.ts", matches: [match] }] };
}

describe("parseContentSearchOutcome - valid variants", () => {
  it("accepts an ok outcome with files and matches", () => {
    expect(parseContentSearchOutcome(validOkOutcome)).toEqual(validOkOutcome);
  });

  it("accepts an ok outcome from the git-grep engine with no files", () => {
    const outcome: ContentSearchOutcome = {
      kind: "ok",
      files: [],
      matchCount: 0,
      fileCount: 0,
      isLimitHit: true,
      isTimedOut: false,
      engine: "git-grep",
      durationMs: 0,
    };

    expect(parseContentSearchOutcome(outcome)).toEqual(outcome);
  });

  it("accepts a zero-length match", () => {
    const value = okWithMatch({ startColumn: 1, endColumn: 1 });

    expect(parseContentSearchOutcome(value)).toEqual(value);
  });

  it.each(["invalid-pattern", "unavailable", "failed"] as const)(
    "accepts a %s outcome with a message",
    (kind) => {
      const outcome = { kind, message: `${kind} happened` };

      expect(parseContentSearchOutcome(outcome)).toEqual(outcome);
    },
  );

  it("survives a JSON round trip", () => {
    const value: unknown = JSON.parse(JSON.stringify(validOkOutcome));

    expect(parseContentSearchOutcome(value)).toEqual(validOkOutcome);
  });
});

describe("parseContentSearchOutcome - rejected values", () => {
  it.each([null, undefined, 42, "ok", [], true])("rejects %j", (value) => {
    expect(parseContentSearchOutcome(value)).toBeNull();
  });

  it("rejects an unknown kind", () => {
    expect(
      parseContentSearchOutcome({ kind: "maybe", message: "x" }),
    ).toBeNull();
  });

  it("rejects an object without a kind", () => {
    expect(parseContentSearchOutcome({ error: "Unauthorized" })).toBeNull();
  });

  it.each(["invalid-pattern", "unavailable", "failed"])(
    "rejects a %s outcome without a string message",
    (kind) => {
      expect(parseContentSearchOutcome({ kind })).toBeNull();
      expect(parseContentSearchOutcome({ kind, message: 7 })).toBeNull();
    },
  );

  it("rejects an ok outcome without files", () => {
    expect(parseContentSearchOutcome({ kind: "ok" })).toBeNull();
    expect(parseContentSearchOutcome(okWithout("files"))).toBeNull();
  });

  it.each([
    "matchCount",
    "fileCount",
    "isLimitHit",
    "isTimedOut",
    "engine",
    "durationMs",
  ])("rejects an ok outcome without %s", (field) => {
    expect(parseContentSearchOutcome(okWithout(field))).toBeNull();
  });

  it("rejects a files value that is not an array", () => {
    expect(
      parseContentSearchOutcome({ ...validOkOutcome, files: {} }),
    ).toBeNull();
  });

  it("rejects a wrong engine", () => {
    expect(
      parseContentSearchOutcome({ ...validOkOutcome, engine: "grep" }),
    ).toBeNull();
  });

  it("rejects non-boolean flags", () => {
    expect(
      parseContentSearchOutcome({ ...validOkOutcome, isLimitHit: "false" }),
    ).toBeNull();
    expect(
      parseContentSearchOutcome({ ...validOkOutcome, isTimedOut: 0 }),
    ).toBeNull();
  });

  it("rejects non-number counts and duration", () => {
    expect(
      parseContentSearchOutcome({ ...validOkOutcome, matchCount: "1" }),
    ).toBeNull();
    expect(
      parseContentSearchOutcome({ ...validOkOutcome, fileCount: Number.NaN }),
    ).toBeNull();
    expect(
      parseContentSearchOutcome({ ...validOkOutcome, durationMs: null }),
    ).toBeNull();
  });

  it("rejects a file without a string path", () => {
    expect(
      parseContentSearchOutcome({
        ...validOkOutcome,
        files: [{ path: 3, matches: [] }],
      }),
    ).toBeNull();
    expect(
      parseContentSearchOutcome({
        ...validOkOutcome,
        files: [{ matches: [] }],
      }),
    ).toBeNull();
  });

  it("rejects a file whose matches are not an array", () => {
    expect(
      parseContentSearchOutcome({
        ...validOkOutcome,
        files: [{ path: "a.ts" }],
      }),
    ).toBeNull();
  });

  it("rejects a match that is not an object", () => {
    expect(
      parseContentSearchOutcome({
        ...validOkOutcome,
        files: [{ path: "a.ts", matches: ["match"] }],
      }),
    ).toBeNull();
  });

  it.each([
    "lineNumber",
    "startColumn",
    "endColumn",
    "startByteColumn",
    "previewMatchStart",
    "previewMatchEnd",
  ])("rejects a non-number %s", (field) => {
    expect(parseContentSearchOutcome(okWithMatch({ [field]: "5" }))).toBeNull();
  });

  it.each([
    "lineNumber",
    "startColumn",
    "endColumn",
    "startByteColumn",
    "matchFingerprint",
    "lineSha256",
    "preview",
    "previewMatchStart",
    "previewMatchEnd",
  ])("rejects a match without %s", (field) => {
    expect(parseContentSearchOutcome(matchWithout(field))).toBeNull();
  });

  it("rejects a non-string matchFingerprint", () => {
    expect(
      parseContentSearchOutcome(okWithMatch({ matchFingerprint: 6 })),
    ).toBeNull();
  });

  it("rejects a non-string preview", () => {
    expect(
      parseContentSearchOutcome(okWithMatch({ preview: null })),
    ).toBeNull();
  });

  it.each([
    ["uppercase hex", "A".repeat(64)],
    ["63 characters", "0".repeat(63)],
    ["65 characters", "0".repeat(65)],
    ["non-hex characters", "g".repeat(64)],
    ["an empty string", ""],
  ])("rejects a lineSha256 with %s", (_label, lineSha256) => {
    expect(parseContentSearchOutcome(okWithMatch({ lineSha256 }))).toBeNull();
  });

  it("rejects a non-string lineSha256", () => {
    expect(
      parseContentSearchOutcome(okWithMatch({ lineSha256: 0 })),
    ).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { escapeGlobLiteral } from "@/packages/shared/src/content-search/glob-escape";

describe("escapeGlobLiteral", () => {
  it("leaves plain paths, colons and non-ASCII untouched", () => {
    expect(escapeGlobLiteral("src/ünï:file.ts")).toBe("src/ünï:file.ts");
  });

  it.each([
    ["a[1].ts", "a\\[1\\].ts"],
    ["x*y.ts", "x\\*y.ts"],
    ["q?.ts", "q\\?.ts"],
    ["b{1,2}.ts", "b\\{1\\,2\\}.ts"],
    ["#hash.ts", "\\#hash.ts"],
    ["!bang.ts", "\\!bang.ts"],
    ["back\\slash.ts", "back\\\\slash.ts"],
    ["sp ace.ts", "sp\\ ace.ts"],
    ["trailing ", "trailing\\ "],
  ])("escapes glob metacharacters in %s", (text, escaped) => {
    expect(escapeGlobLiteral(text)).toBe(escaped);
  });
});

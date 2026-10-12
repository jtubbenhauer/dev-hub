// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFileContentIfUnchanged } from "@/lib/files/operations";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "devhub-save-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));
describe("writeFileContentIfUnchanged", () => {
  it("writes synchronously when the exact base matches", () => {
    writeFileSync(join(root, "a.ts"), "base");
    expect(writeFileContentIfUnchanged(root, "a.ts", "next", "base")).toBe(
      "written",
    );
    expect(readFileSync(join(root, "a.ts"), "utf8")).toBe("next");
  });
  it("refuses different content of the same length", () => {
    writeFileSync(join(root, "a.ts"), "disk");
    expect(writeFileContentIfUnchanged(root, "a.ts", "next", "base")).toBe(
      "stale",
    );
    expect(readFileSync(join(root, "a.ts"), "utf8")).toBe("disk");
  });
  it("refuses missing files without creating them", () => {
    expect(writeFileContentIfUnchanged(root, "missing.ts", "next", "")).toBe(
      "stale",
    );
    expect(existsSync(join(root, "missing.ts"))).toBe(false);
  });
  it("rejects traversal", () => {
    expect(() =>
      writeFileContentIfUnchanged(root, "../escape.ts", "next", "base"),
    ).toThrow("Path traversal denied");
  });
});

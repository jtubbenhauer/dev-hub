// @vitest-environment node
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { sha256Utf8Hex } from "@/packages/shared/src/content-search/line-hash";

describe("sha256Utf8Hex", () => {
  it("hashes the empty string", () => {
    expect(sha256Utf8Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("matches the hash Neovim's sha256(getline(n)) produced for an ASCII line", () => {
    expect(sha256Utf8Hex("a needle here")).toBe(
      "795c238dcce900c0131e710c25229cc164f8c22b48bb0d5ea3343ad340d91bc4",
    );
  });

  it("hashes the UTF-8 bytes of a non-ASCII line", () => {
    const expected = createHash("sha256")
      .update(Buffer.from([0xc3, 0xa9]))
      .digest("hex");

    expect(sha256Utf8Hex("é")).toBe(expected);
  });
});

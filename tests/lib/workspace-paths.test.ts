import { describe, it, expect } from "vitest";
import { toRepoRelative } from "@/lib/workspace-paths";

describe("toRepoRelative", () => {
  it("strips workspace root prefix from absolute path", () => {
    expect(toRepoRelative("/ws/root/foo.ts", "/ws/root")).toBe("foo.ts");
  });

  it("handles root with trailing slash same as root without", () => {
    expect(toRepoRelative("/ws/root/foo.ts", "/ws/root/")).toBe("foo.ts");
  });

  it("returns already-relative plain path unchanged", () => {
    expect(toRepoRelative("foo/bar.ts", "/ws/root")).toBe("foo/bar.ts");
  });

  it("strips leading ./ from relative path", () => {
    expect(toRepoRelative("./foo", "/ws/root")).toBe("foo");
  });

  it("returns absolute path not under root unchanged", () => {
    expect(toRepoRelative("/other/place/f.ts", "/ws/root")).toBe(
      "/other/place/f.ts",
    );
  });

  it("strips ./ with empty root", () => {
    expect(toRepoRelative("./foo", "")).toBe("foo");
  });

  it("returns plain relative path unchanged with empty root", () => {
    expect(toRepoRelative("foo", "")).toBe("foo");
  });
});

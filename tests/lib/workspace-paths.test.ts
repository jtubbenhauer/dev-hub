import { describe, it, expect } from "vitest";
import {
  toRepoRelative,
  fileViewKey,
  isOutsideRepoPath,
} from "@/lib/workspace-paths";

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

describe("fileViewKey", () => {
  it("namespaces the repo-relative path by workspace id", () => {
    expect(fileViewKey("ws1", "src/a.ts")).toBe("ws1:src/a.ts");
  });

  it("produces distinct keys for the same path under different workspaces", () => {
    expect(fileViewKey("ws1", "a.ts")).not.toBe(fileViewKey("ws2", "a.ts"));
  });
});

describe("isOutsideRepoPath", () => {
  it("flags a POSIX-absolute path", () => {
    expect(isOutsideRepoPath("/foo")).toBe(true);
  });

  it("flags a Windows drive-letter absolute path", () => {
    expect(isOutsideRepoPath("C:\\x")).toBe(true);
  });

  it("flags a UNC path", () => {
    expect(isOutsideRepoPath("\\\\server\\share")).toBe(true);
  });

  it("flags a leading .. traversal", () => {
    expect(isOutsideRepoPath("../outside.ts")).toBe(true);
  });

  it("flags an embedded .. traversal segment", () => {
    expect(isOutsideRepoPath("a/../b.ts")).toBe(true);
  });

  it("flags a backslash-separated .. traversal segment", () => {
    expect(isOutsideRepoPath("a\\..\\b.ts")).toBe(true);
  });

  it("treats a plain relative path as inside the repo", () => {
    expect(isOutsideRepoPath("foo/bar.ts")).toBe(false);
  });
});

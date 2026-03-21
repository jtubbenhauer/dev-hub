// @vitest-environment node
import { describe, it, expect } from "vitest";
import { getWorktreeBaseDir } from "@/lib/git/worktrees";

describe("getWorktreeBaseDir", () => {
  it("appends -worktrees to the resolved path", () => {
    const result = getWorktreeBaseDir("/home/user/dev/my-repo");
    expect(result).toBe("/home/user/dev/my-repo-worktrees");
  });

  it("resolves relative paths before appending", () => {
    const result = getWorktreeBaseDir("/home/user/dev/../dev/my-repo");
    expect(result).toBe("/home/user/dev/my-repo-worktrees");
  });

  it("handles paths with trailing slashes", () => {
    // path.resolve strips trailing slashes
    const result = getWorktreeBaseDir("/home/user/dev/my-repo/");
    expect(result).toBe("/home/user/dev/my-repo-worktrees");
  });

  it("handles deeply nested repo paths", () => {
    const result = getWorktreeBaseDir("/a/b/c/d/repo");
    expect(result).toBe("/a/b/c/d/repo-worktrees");
  });

  it("handles repo names with hyphens", () => {
    const result = getWorktreeBaseDir("/home/user/my-cool-repo");
    expect(result).toBe("/home/user/my-cool-repo-worktrees");
  });
});

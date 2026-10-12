import { describe, expect, it } from "vitest";
import {
  buildFileSaveBody,
  resolveTabWorkspaceId,
} from "@/lib/files/save-request";

describe("save request", () => {
  const input = {
    workspaceId: "A",
    path: "a.ts",
    content: "typed",
    originalContent: "base",
  };
  it("omits baseContent entirely when LSP is off", () => {
    expect(buildFileSaveBody({ ...input, isLspEnabled: false })).toEqual({
      workspaceId: "A",
      path: "a.ts",
      content: "typed",
    });
  });
  it("sends the exact original content when LSP is on", () => {
    expect(buildFileSaveBody({ ...input, isLspEnabled: true })).toEqual({
      workspaceId: "A",
      path: "a.ts",
      content: "typed",
      baseContent: "base",
    });
  });
  it("uses the tab workspace instead of the active workspace", () => {
    expect(resolveTabWorkspaceId({ workspaceId: "A" }, "B")).toBe("A");
  });
  it("uses the fallback for legacy tabs", () => {
    expect(resolveTabWorkspaceId({}, "B")).toBe("B");
  });
});

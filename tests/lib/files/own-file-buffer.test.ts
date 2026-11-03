import { describe, expect, it } from "vitest";

import { findOwnFileBuffer } from "@/lib/files/own-file-buffer";
import type { OpenFile } from "@/types";

function buffer(overrides: Partial<OpenFile>): OpenFile {
  return {
    path: "src/a.ts",
    name: "a.ts",
    content: "text",
    originalContent: "text",
    language: "typescript",
    isDirty: false,
    ...overrides,
  };
}

describe("findOwnFileBuffer", () => {
  it("finds the buffer the workspace opened for the path", () => {
    // Given
    const ownBuffer = buffer({ workspaceId: "ws1" });

    // When
    const found = findOwnFileBuffer(
      [buffer({ workspaceId: "ws1", path: "src/b.ts" }), ownBuffer],
      "ws1",
      "src/a.ts",
    );

    // Then
    expect(found).toBe(ownBuffer);
  });

  it("adopts a legacy buffer that has no workspace", () => {
    // Given
    const legacyBuffer = buffer({ workspaceId: undefined });

    // When
    const found = findOwnFileBuffer([legacyBuffer], "ws1", "src/a.ts");

    // Then
    expect(found).toBe(legacyBuffer);
  });

  it("ignores another workspace's buffer for the same path", () => {
    // When
    const found = findOwnFileBuffer(
      [buffer({ workspaceId: "ws2" })],
      "ws1",
      "src/a.ts",
    );

    // Then
    expect(found).toBeUndefined();
  });
});

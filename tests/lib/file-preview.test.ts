import { describe, expect, it } from "vitest";
import { getRawFileUrl, isPdfPath } from "@/lib/file-preview";

describe("isPdfPath", () => {
  it("matches .pdf case-insensitively", () => {
    expect(isPdfPath("docs/report.pdf")).toBe(true);
    expect(isPdfPath("docs/REPORT.PDF")).toBe(true);
  });

  it("rejects other files", () => {
    expect(isPdfPath("docs/report.pdf.txt")).toBe(false);
    expect(isPdfPath("src/pdf.ts")).toBe(false);
  });
});

describe("getRawFileUrl", () => {
  it("encodes the workspace and path as query params", () => {
    expect(getRawFileUrl("ws-1", "docs/a b&c.pdf")).toBe(
      "/api/files/raw?workspaceId=ws-1&path=docs%2Fa+b%26c.pdf",
    );
  });
});

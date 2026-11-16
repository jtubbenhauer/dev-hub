import { afterEach, describe, expect, it, vi } from "vitest";
import {
  saveWorkspaceUpload,
  WORKSPACE_UPLOADS_DIR,
} from "@/lib/workspaces/uploads";

function createRecordingBackend() {
  const writes: Array<{ path: string; content: string }> = [];
  return {
    writes,
    backend: {
      writeFile: async (path: string, content: string) => {
        writes.push({ path, content });
      },
      writeFileBytes: async (path: string, bytes: Uint8Array) => {
        writes.push({ path, content: Buffer.from(bytes).toString("utf8") });
      },
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("saveWorkspaceUpload", () => {
  it("writes a git-ignored uploads folder and the file under a timestamped name", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-13T01:30:45.678Z"));
    const { backend, writes } = createRecordingBackend();

    const uploadPath = await saveWorkspaceUpload(
      backend,
      "data.json",
      Buffer.from('{"a":1}'),
    );

    expect(uploadPath).toMatch(
      /^\.devhub\/uploads\/20261013-013045-[0-9a-f]{6}-data\.json$/,
    );
    expect(writes).toEqual([
      { path: `${WORKSPACE_UPLOADS_DIR}/.gitignore`, content: "*\n" },
      { path: uploadPath, content: '{"a":1}' },
    ]);
  });

  it("gives repeated uploads of the same file different paths", async () => {
    const { backend } = createRecordingBackend();

    const firstPath = await saveWorkspaceUpload(
      backend,
      "data.json",
      Buffer.from("1"),
    );
    const secondPath = await saveWorkspaceUpload(
      backend,
      "data.json",
      Buffer.from("2"),
    );

    expect(firstPath).not.toBe(secondPath);
  });

  it.each([
    ["../../etc/passwd", "passwd"],
    ["..\\..\\secret.json", "secret.json"],
    ["My Report (final).json", "My-Report-final-.json"],
    ["Zoë 日本語.json", "Zoë-日本語.json"],
    [".env", "env"],
    ["///", "attachment"],
  ])("saves %j as %j inside the uploads folder", async (filename, expected) => {
    const { backend } = createRecordingBackend();

    const uploadPath = await saveWorkspaceUpload(
      backend,
      filename,
      Buffer.from("x"),
    );

    expect(uploadPath.startsWith(`${WORKSPACE_UPLOADS_DIR}/`)).toBe(true);
    expect(uploadPath.endsWith(`-${expected}`)).toBe(true);
    expect(uploadPath.slice(WORKSPACE_UPLOADS_DIR.length + 1)).not.toContain(
      "/",
    );
  });

  it("caps long names while keeping the extension", async () => {
    const { backend } = createRecordingBackend();

    const uploadPath = await saveWorkspaceUpload(
      backend,
      `${"x".repeat(300)}.json`,
      Buffer.from("x"),
    );
    const savedName = uploadPath.split("/").pop() ?? "";

    expect(savedName.endsWith(".json")).toBe(true);
    expect(savedName.length).toBeLessThanOrEqual(130);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useEditorStore } from "@/stores/editor-store";
import type { OpenFile } from "@/types";

const fetchMock = vi.fn<(url: string) => Promise<Response>>();

function buffer(overrides: Partial<OpenFile> = {}): OpenFile {
  return {
    workspaceId: "ws1",
    instanceId: 1,
    path: "src/a.ts",
    name: "a.ts",
    content: "old",
    originalContent: "old",
    language: "typescript",
    isDirty: false,
    ...overrides,
  };
}

function reload() {
  return useEditorStore.getState().reloadFileFromDisk("ws1", "src/a.ts");
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  useEditorStore.setState({ openFiles: [buffer()], activeFilePath: null });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("editor-store reloadFileFromDisk", () => {
  it("replaces a clean buffer with the content on disk", async () => {
    // Given
    fetchMock.mockResolvedValue(Response.json({ content: "new" }));

    // When
    const result = await reload();

    // Then
    expect(result).toBe("reloaded");
    expect(useEditorStore.getState().openFiles[0]).toMatchObject({
      content: "new",
      originalContent: "new",
      isDirty: false,
    });
  });

  it("reads the file of that workspace and path", async () => {
    // Given
    fetchMock.mockResolvedValue(Response.json({ content: "new" }));

    // When
    await reload();

    // Then
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      "/api/files/content?workspaceId=ws1&path=src%2Fa.ts",
    );
  });

  it("reports unchanged when the disk matches the buffer", async () => {
    // Given
    fetchMock.mockResolvedValue(Response.json({ content: "old" }));

    // When
    const result = await reload();

    // Then
    expect(result).toBe("unchanged");
  });

  it("skips a dirty buffer without reading the disk", async () => {
    // Given
    useEditorStore.setState({
      openFiles: [buffer({ content: "typed", isDirty: true })],
    });

    // When
    const result = await reload();

    // Then
    expect(result).toBe("dirty-skipped");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(useEditorStore.getState().openFiles[0].content).toBe("typed");
  });

  it("keeps edits typed while the disk read was in flight", async () => {
    // Given
    let finishRead: (response: Response) => void = () => {};
    fetchMock.mockReturnValue(
      new Promise<Response>((resolve) => {
        finishRead = resolve;
      }),
    );
    const pendingReload = reload();
    useEditorStore.getState().updateFileContent("src/a.ts", "typed");

    // When
    finishRead(Response.json({ content: "new" }));
    const result = await pendingReload;

    // Then
    expect(result).toBe("dirty-skipped");
    expect(useEditorStore.getState().openFiles[0].content).toBe("typed");
  });

  it("reports not-open when only another workspace holds the path", async () => {
    // Given
    useEditorStore.setState({ openFiles: [buffer({ workspaceId: "ws2" })] });

    // When
    const result = await reload();

    // Then
    expect(result).toBe("not-open");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [
      "an error status",
      () => Promise.resolve(new Response(null, { status: 404 })),
    ],
    ["a network error", () => Promise.reject(new TypeError("Failed to fetch"))],
    ["a body without content", () => Promise.resolve(Response.json({}))],
  ])("reports fetch-failed for %s and keeps the buffer", async (_, reply) => {
    // Given
    fetchMock.mockImplementation(reply);

    // When
    const result = await reload();

    // Then
    expect(result).toBe("fetch-failed");
    expect(useEditorStore.getState().openFiles[0].content).toBe("old");
  });
});

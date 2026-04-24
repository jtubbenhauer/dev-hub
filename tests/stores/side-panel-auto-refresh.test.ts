import { describe, it, expect, vi, beforeEach } from "vitest";
import { useSidePanelStore } from "@/stores/side-panel-store";
import { extractFilePathFromToolPart } from "@/lib/chat/extract-tool-file-path";
import type { OpenFile } from "@/types";
import type { Part } from "@/lib/opencode/types";

const baseState = {
  isOpen: false,
  activeTab: "files" as const,
  activePanelTab: "status" as const,
  openFiles: [] as OpenFile[],
  activeFilePath: null as string | null,
  isFilePickerOpen: false,
  isLoading: false,
  error: null as string | null,
  expandedPaths: [] as string[],
  workspaceFileStates: {} as Record<
    string,
    {
      files: { path: string; name: string; language: string }[];
      activeFilePath: string | null;
    }
  >,
};

function resetStore(openFiles: OpenFile[] = []) {
  useSidePanelStore.setState({ ...baseState, openFiles });
}

function makeFile(overrides: Partial<OpenFile> = {}): OpenFile {
  return {
    path: "src/foo.ts",
    name: "foo.ts",
    content: "original content",
    language: "typescript",
    isDirty: false,
    originalContent: "original content",
    ...overrides,
  };
}

describe("reloadFileFromDisk", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns 'not-open' when file is not in openFiles", async () => {
    resetStore([]);
    const result = await useSidePanelStore
      .getState()
      .reloadFileFromDisk("ws1", "src/foo.ts");
    expect(result).toBe("not-open");
  });

  it("returns 'dirty-skipped' when file is dirty", async () => {
    const dirtyFile = makeFile({ isDirty: true, content: "modified" });
    resetStore([dirtyFile]);
    const result = await useSidePanelStore
      .getState()
      .reloadFileFromDisk("ws1", "src/foo.ts");
    expect(result).toBe("dirty-skipped");
    const file = useSidePanelStore
      .getState()
      .openFiles.find((f) => f.path === "src/foo.ts");
    expect(file?.content).toBe("modified");
  });

  it("returns 'reloaded' and updates content+originalContent, isDirty=false on success", async () => {
    const cleanFile = makeFile();
    resetStore([cleanFile]);

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: "new content from disk",
        language: "typescript",
      }),
    } as Response);

    const result = await useSidePanelStore
      .getState()
      .reloadFileFromDisk("ws1", "src/foo.ts");
    expect(result).toBe("reloaded");

    const file = useSidePanelStore
      .getState()
      .openFiles.find((f) => f.path === "src/foo.ts");
    expect(file?.content).toBe("new content from disk");
    expect(file?.originalContent).toBe("new content from disk");
    expect(file?.isDirty).toBe(false);
  });

  it("returns 'fetch-failed' on non-ok response", async () => {
    const cleanFile = makeFile();
    resetStore([cleanFile]);

    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
    } as Response);

    const result = await useSidePanelStore
      .getState()
      .reloadFileFromDisk("ws1", "src/foo.ts");
    expect(result).toBe("fetch-failed");
  });

  it("returns 'fetch-failed' when fetch throws", async () => {
    const cleanFile = makeFile();
    resetStore([cleanFile]);

    global.fetch = vi.fn().mockRejectedValue(new Error("network error"));

    const result = await useSidePanelStore
      .getState()
      .reloadFileFromDisk("ws1", "src/foo.ts");
    expect(result).toBe("fetch-failed");
  });
});

describe("extractFilePathFromToolPart", () => {
  function makePart(
    tool: string,
    status: string,
    input: Record<string, unknown>,
  ): Part {
    return {
      type: "tool",
      id: "test-id",
      tool,
      state: {
        status: status as "completed" | "running" | "error",
        input,
        output: undefined,
        title: "",
      },
    } as unknown as Part;
  }

  it("returns path for completed write with filePath key", () => {
    const part = makePart("write", "completed", { filePath: "src/foo.ts" });
    expect(extractFilePathFromToolPart(part)).toBe("src/foo.ts");
  });

  it("returns path for completed edit with path key", () => {
    const part = makePart("edit", "completed", { path: "src/bar.ts" });
    expect(extractFilePathFromToolPart(part)).toBe("src/bar.ts");
  });

  it("returns path for completed write with file_path key", () => {
    const part = makePart("write", "completed", { file_path: "src/baz.ts" });
    expect(extractFilePathFromToolPart(part)).toBe("src/baz.ts");
  });

  it("returns path for completed write with file key", () => {
    const part = makePart("write", "completed", { file: "src/qux.ts" });
    expect(extractFilePathFromToolPart(part)).toBe("src/qux.ts");
  });

  it("returns null for read tool (not in allowlist)", () => {
    const part = makePart("read", "completed", { filePath: "src/foo.ts" });
    expect(extractFilePathFromToolPart(part)).toBeNull();
  });

  it("returns null for write with status running", () => {
    const part = makePart("write", "running", { filePath: "src/foo.ts" });
    expect(extractFilePathFromToolPart(part)).toBeNull();
  });

  it("returns null for write with status error", () => {
    const part = makePart("write", "error", { filePath: "src/foo.ts" });
    expect(extractFilePathFromToolPart(part)).toBeNull();
  });

  it("returns null for non-tool part", () => {
    const part = { type: "text", content: "hello" } as unknown as Part;
    expect(extractFilePathFromToolPart(part)).toBeNull();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { useChatFileDialogStore } from "@/stores/chat-file-dialog-store";

describe("chat file dialog store", () => {
  beforeEach(() => {
    useChatFileDialogStore.getState().reset();
    vi.restoreAllMocks();
  });

  it("loads a file and opens it in the dialog", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            content: "const value = 1;",
            language: "typescript",
          }),
          { status: 200 },
        ),
      ),
    );
    const fallback = vi.fn();

    await useChatFileDialogStore
      .getState()
      .openFile("workspace-1", "src/value.ts", fallback);

    const state = useChatFileDialogStore.getState();
    expect(state.isOpen).toBe(true);
    expect(state.file).toEqual({
      path: "src/value.ts",
      content: "const value = 1;",
      language: "typescript",
      workspaceId: "workspace-1",
    });
    expect(fallback).not.toHaveBeenCalled();
  });

  it("opens PDFs as a preview without fetching text content", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const fallback = vi.fn();

    await useChatFileDialogStore
      .getState()
      .openFile("workspace-1", "docs/spec.pdf", fallback);

    const state = useChatFileDialogStore.getState();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(state.isOpen).toBe(true);
    expect(state.isLoading).toBe(false);
    expect(state.file).toEqual({
      path: "docs/spec.pdf",
      content: "",
      language: "pdf",
      workspaceId: "workspace-1",
    });
  });

  it("uses the full editor fallback when the file cannot be loaded", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 404 })),
    );
    const fallback = vi.fn();

    await useChatFileDialogStore
      .getState()
      .openFile("workspace-1", "missing.ts", fallback);

    expect(fallback).toHaveBeenCalledOnce();
    expect(useChatFileDialogStore.getState().isOpen).toBe(false);
  });
});

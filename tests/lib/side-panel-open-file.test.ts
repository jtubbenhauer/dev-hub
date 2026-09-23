import { beforeEach, describe, expect, it, vi } from "vitest";
import { openFileInSidePanel } from "@/lib/side-panel-open-file";
import { useSidePanelStore } from "@/stores/side-panel-store";
import { PDF_LANGUAGE } from "@/lib/file-preview";

describe("openFileInSidePanel", () => {
  beforeEach(() => {
    useSidePanelStore.getState().clearFile();
    vi.restoreAllMocks();
  });

  it("opens PDFs as a preview tab without fetching text content", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const fallback = vi.fn();

    await openFileInSidePanel("ws-1", "docs/spec.pdf", fallback);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(fallback).not.toHaveBeenCalled();
    const state = useSidePanelStore.getState();
    expect(state.activeFilePath).toBe("docs/spec.pdf");
    const tab = state.openFiles.find((f) => f.path === "docs/spec.pdf");
    expect(tab?.language).toBe(PDF_LANGUAGE);
    expect(state.isLoading).toBe(false);
  });
});

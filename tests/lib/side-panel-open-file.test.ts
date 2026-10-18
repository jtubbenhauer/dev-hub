import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openFileInSidePanel } from "@/lib/side-panel-open-file";
import { useSidePanelStore } from "@/stores/side-panel-store";
import {
  BINARY_FILE_LANGUAGE,
  IMAGE_LANGUAGE,
  PDF_LANGUAGE,
} from "@/lib/file-preview";
import { toast } from "sonner";
vi.mock("sonner", () => ({ toast: { warning: vi.fn() } }));
import {
  isPendingNavigationCurrent,
  setPendingNavigation,
} from "@/lib/lsp/client/navigation-registry";

describe("openFileInSidePanel", () => {
  it("returns true for a new file", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ content: "disk" })),
    );
    expect(await openFileInSidePanel("B", "a.ts", vi.fn())).toBe(true);
    expect(useSidePanelStore.getState().openFiles[0].workspaceId).toBe("B");
  });
  it("returns false and falls back on a failed fetch", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 404 })),
    );
    const fallback = vi.fn();
    expect(await openFileInSidePanel("B", "a.ts", fallback)).toBe(false);
    expect(fallback).toHaveBeenCalledOnce();
  });
  it("returns false for a foreign dirty tab", async () => {
    useSidePanelStore
      .getState()
      .openFileInTab("a.ts", "base", "typescript", "A");
    useSidePanelStore.getState().updateFileContent("a.ts", "dirty");
    const previous = useSidePanelStore.getState().openFiles[0];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ content: "disk" })),
    );
    expect(await openFileInSidePanel("B", "a.ts", vi.fn())).toBe(false);
    expect(useSidePanelStore.getState().openFiles[0]).toBe(previous);
    expect(toast.warning).toHaveBeenCalledWith(
      "a.ts from another workspace has unsaved changes — save or close it first",
    );
  });
  beforeEach(() => {
    useSidePanelStore.getState().clearFile();
    vi.restoreAllMocks();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("never opens A or calls its fallback when B supersedes it and finishes first", async () => {
    let finishA: (value: Response) => void = () => {};
    let finishB: (value: Response) => void = () => {};
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise<Response>((resolve) => {
              finishA = resolve;
            }),
        )
        .mockImplementationOnce(
          () =>
            new Promise<Response>((resolve) => {
              finishB = resolve;
            }),
        ),
    );
    const fallbackA = vi.fn();
    const openedPaths: string[] = [];
    const unsubscribe = useSidePanelStore.subscribe((state) => {
      openedPaths.push(...state.openFiles.map((file) => file.path));
    });
    const tokenA = setPendingNavigation("split-panel", {
      uriKey: "a",
      lineNumber: 1,
      column: 1,
    });
    const a = openFileInSidePanel("ws-1", "a.ts", fallbackA, () =>
      isPendingNavigationCurrent("split-panel", tokenA),
    );
    const tokenB = setPendingNavigation("split-panel", {
      uriKey: "b",
      lineNumber: 1,
      column: 1,
    });
    const b = openFileInSidePanel("ws-1", "b.ts", vi.fn(), () =>
      isPendingNavigationCurrent("split-panel", tokenB),
    );

    finishB(Response.json({ content: "B", language: "typescript" }));
    await b;
    finishA(Response.json({ content: "A", language: "typescript" }));
    await a;

    unsubscribe();
    expect(useSidePanelStore.getState().activeFilePath).toBe("b.ts");
    expect(openedPaths).not.toContain("a.ts");
    expect(fallbackA).not.toHaveBeenCalled();
  });

  it("does not activate the files panel when shouldCommit refuses", async () => {
    useSidePanelStore.getState().setActivePanelTab("git");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ content: "disk" })),
    );
    const fallback = vi.fn();

    await openFileInSidePanel("ws-1", "a.ts", fallback, () => false);

    expect(useSidePanelStore.getState().activePanelTab).toBe("git");
    expect(useSidePanelStore.getState().openFiles).toEqual([]);
    expect(fallback).not.toHaveBeenCalled();
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

  it("opens images as a preview tab without fetching text content", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const fallback = vi.fn();

    await openFileInSidePanel("ws-1", "assets/screenshot.jpg", fallback);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(fallback).not.toHaveBeenCalled();
    const state = useSidePanelStore.getState();
    expect(state.activeFilePath).toBe("assets/screenshot.jpg");
    const tab = state.openFiles.find((f) => f.path === "assets/screenshot.jpg");
    expect(tab?.language).toBe(IMAGE_LANGUAGE);
    expect(state.activePanelTab).toBe("files");
  });

  it("opens a file the editor refuses as a download tab instead of falling back", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ error: "binary" }, { status: 415 })),
    );
    const fallback = vi.fn();

    await openFileInSidePanel("ws-1", "build/app.zip", fallback);

    expect(fallback).not.toHaveBeenCalled();
    const tab = useSidePanelStore
      .getState()
      .openFiles.find((f) => f.path === "build/app.zip");
    expect(tab?.language).toBe(BINARY_FILE_LANGUAGE);
  });
});

import type * as Monaco from "monaco-editor";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { connectLspBrowserTransport } from "@/lib/lsp/client/browser-transport";
import {
  createSessionFixture,
  fakeModel,
  fakeSource,
  fakeUri,
  sessionOptions,
} from "./lsp-session-fixture";

vi.mock("@/lib/lsp/client/browser-transport");
describe("LSP editor opener", () => {
  let registry: typeof import("@/lib/lsp/client/navigation-registry");
  let fixture: ReturnType<typeof createSessionFixture>;
  let handle: { dispose(): void };
  let opener: Monaco.editor.ICodeEditorOpener;
  const uri = "file:///Workspace/src/b.ts";
  const position = { lineNumber: 3, column: 5 };
  const handler =
    vi.fn<
      (relativePath: string, isCurrent: () => boolean) => Promise<boolean>
    >();
  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    handler.mockReset();
    handler.mockResolvedValue(true);
    fixture = createSessionFixture();
    vi.mocked(connectLspBrowserTransport).mockResolvedValue(fixture.transport);
    registry = await import("@/lib/lsp/client/navigation-registry");
    const session = await import("@/lib/lsp/client/lsp-session");
    session.registerLspMonacoInstance(fixture.monaco);
    handle = await session.connectLspSession(sessionOptions);
    const registered = fixture.editor.registerEditorOpener.mock.calls[0]?.[0];
    if (!registered) throw new Error("Expected registered opener");
    opener = registered;
  });
  afterEach(() => {
    handle.dispose();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("declines navigation when no surface handler is registered", () => {
    expect(
      opener.openCodeEditor(fakeSource("files-page"), fakeUri(uri), position),
    ).toBe(false);
    expect(
      registry.takePendingNavigation("files-page", uri.toLowerCase()),
    ).toBeNull();
  });
  it.each(["other", null])("declines a non-allowed surface %s", (surface) => {
    registry.registerLspOpenFileHandler("files-page", handler);
    expect(
      opener.openCodeEditor(fakeSource(surface), fakeUri(uri), position),
    ).toBe(false);
    expect(handler).not.toHaveBeenCalled();
    expect(
      registry.takePendingNavigation(surface, uri.toLowerCase()),
    ).toBeNull();
  });
  it("leaves same-file jumps to Monaco without a pending entry", () => {
    registry.registerLspOpenFileHandler("files-page", handler);
    expect(
      opener.openCodeEditor(
        fakeSource("files-page", fakeModel(uri)),
        fakeUri(uri),
        position,
      ),
    ).toBe(false);
    expect(handler).not.toHaveBeenCalled();
    expect(
      registry.takePendingNavigation("files-page", uri.toLowerCase()),
    ).toBeNull();
  });
  it("declines out-of-scope navigation without invoking the handler", () => {
    registry.registerLspOpenFileHandler("files-page", handler);
    expect(
      opener.openCodeEditor(
        fakeSource("files-page"),
        fakeUri("file:///Other/a.ts"),
      ),
    ).toBe(false);
    expect(handler).not.toHaveBeenCalled();
  });
  it.each(["files-page", "split-panel"] as const)(
    "stores navigation by surface %s across editor remounts",
    async (surface) => {
      registry.registerLspOpenFileHandler(surface, handler);
      expect(
        opener.openCodeEditor(fakeSource(surface), fakeUri(uri), position),
      ).toBe(true);
      await Promise.resolve();
      expect(handler).toHaveBeenCalledWith("src/b.ts", expect.any(Function));
      vi.advanceTimersByTime(5_000);
      expect(
        registry.takePendingNavigation(surface, uri.toLowerCase()),
      ).toEqual(position);
      expect(handler.mock.calls[0]?.[1]()).toBe(true);
    },
  );
  it.each([
    { selection: undefined, expected: { lineNumber: 1, column: 1 } },
    {
      selection: {
        startLineNumber: 7,
        startColumn: 9,
        endLineNumber: 8,
        endColumn: 2,
      },
      expected: { lineNumber: 7, column: 9 },
    },
  ])(
    "uses the correct cursor position for $selection",
    ({ selection, expected }) => {
      registry.registerLspOpenFileHandler("files-page", handler);
      opener.openCodeEditor(fakeSource("files-page"), fakeUri(uri), selection);
      expect(
        registry.takePendingNavigation("files-page", uri.toLowerCase()),
      ).toEqual(expected);
    },
  );
  it.each([false, "reject"] as const)(
    "clears the entry immediately when the handler returns %s",
    async (outcome) => {
      if (outcome === false) handler.mockResolvedValue(false);
      else handler.mockRejectedValue(new Error("open failed"));
      registry.registerLspOpenFileHandler("files-page", handler);
      opener.openCodeEditor(fakeSource("files-page"), fakeUri(uri), position);
      await Promise.resolve();
      expect(
        registry.takePendingNavigation("files-page", uri.toLowerCase()),
      ).toBeNull();
    },
  );
  it("clears an opened entry when the surface moves past it", async () => {
    registry.registerLspOpenFileHandler("files-page", handler);
    opener.openCodeEditor(fakeSource("files-page"), fakeUri(uri), position);
    await Promise.resolve();
    expect(registry.takePendingNavigation("files-page", "other")).toBeNull();
    expect(
      registry.takePendingNavigation("files-page", uri.toLowerCase()),
    ).toBeNull();
  });
  it("keeps an in-flight entry when the previous editor renders", () => {
    handler.mockReturnValue(new Promise(() => {}));
    registry.registerLspOpenFileHandler("files-page", handler);
    opener.openCodeEditor(fakeSource("files-page"), fakeUri(uri), position);
    expect(registry.takePendingNavigation("files-page", "other")).toBeNull();
    expect(
      registry.takePendingNavigation("files-page", uri.toLowerCase()),
    ).toEqual(position);
  });
  it("supersedes a slower navigation without letting its failure clear the new entry", async () => {
    let resolveFirst: (opened: boolean) => void = () => {};
    handler.mockReturnValueOnce(
      new Promise<boolean>((resolve) => {
        resolveFirst = resolve;
      }),
    );
    registry.registerLspOpenFileHandler("files-page", handler);
    opener.openCodeEditor(fakeSource("files-page"), fakeUri(uri), position);
    expect(handler.mock.calls[0]?.[1]()).toBe(true);
    const nextUri = "file:///Workspace/src/c.ts";
    opener.openCodeEditor(fakeSource("files-page"), fakeUri(nextUri), position);
    resolveFirst(false);
    await Promise.resolve();
    expect(handler.mock.calls[0]?.[1]()).toBe(false);
    expect(handler.mock.calls[1]?.[1]()).toBe(true);
    expect(
      registry.takePendingNavigation("files-page", nextUri.toLowerCase()),
    ).toEqual(position);
    vi.advanceTimersByTime(10_000);
    expect(handler.mock.calls[1]?.[1]()).toBe(false);
  });
});

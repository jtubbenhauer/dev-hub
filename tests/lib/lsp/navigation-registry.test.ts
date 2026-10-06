import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const target = { uriKey: "file:///workspace/a.ts", lineNumber: 4, column: 8 };
let registry: typeof import("@/lib/lsp/client/navigation-registry");
describe("surface navigation registry", () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    registry = await import("@/lib/lsp/client/navigation-registry");
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("returns only the current handler when registrations are replaced", () => {
    const first = vi.fn(async () => true);
    const second = vi.fn(async () => false);
    const unregister = registry.registerLspOpenFileHandler("files-page", first);
    const unregisterSecond = registry.registerLspOpenFileHandler(
      "files-page",
      second,
    );
    unregister();
    expect(registry.getLspOpenFileHandler("files-page")).toBe(second);
    expect(registry.getLspOpenFileHandler("other")).toBeUndefined();
    expect(registry.getLspOpenFileHandler(null)).toBeUndefined();
    expect(registry.getLspOpenFileHandler(undefined)).toBeUndefined();
    unregisterSecond();
    expect(registry.getLspOpenFileHandler("files-page")).toBeUndefined();
  });

  it("keeps currency when a matching entry was consumed", () => {
    const token = registry.setPendingNavigation("files-page", target);
    expect(registry.takePendingNavigation("files-page", target.uriKey)).toEqual(
      { lineNumber: 4, column: 8 },
    );
    expect(
      registry.takePendingNavigation("files-page", target.uriKey),
    ).toBeNull();
    expect(registry.isPendingNavigationCurrent("files-page", token)).toBe(true);
    vi.advanceTimersByTime(10_000);
    expect(registry.isPendingNavigationCurrent("files-page", token)).toBe(
      false,
    );
  });

  it("keeps currency when a failed entry was cleared", () => {
    const token = registry.setPendingNavigation("files-page", target);
    registry.clearPendingNavigation("files-page", token);
    expect(
      registry.takePendingNavigation("files-page", target.uriKey),
    ).toBeNull();
    expect(registry.isPendingNavigationCurrent("files-page", token)).toBe(true);
  });

  it("leaves an in-flight entry when another file is rendered", () => {
    registry.setPendingNavigation("files-page", target);
    expect(registry.takePendingNavigation("files-page", "other")).toBeNull();
    expect(registry.takePendingNavigation("files-page", target.uriKey)).toEqual(
      { lineNumber: 4, column: 8 },
    );
  });

  it("clears an opened entry when the surface moves past the target", () => {
    const token = registry.setPendingNavigation("files-page", target);
    registry.markPendingNavigationOpened("files-page", token);
    expect(registry.takePendingNavigation("files-page", "other")).toBeNull();
    expect(
      registry.takePendingNavigation("files-page", target.uriKey),
    ).toBeNull();
  });

  it("preserves the replacement when an older navigation clears or marks opened", () => {
    const first = registry.setPendingNavigation("files-page", target);
    const second = registry.setPendingNavigation("files-page", {
      ...target,
      uriKey: "new",
    });
    registry.clearPendingNavigation("files-page", first);
    registry.markPendingNavigationOpened("files-page", first);
    expect(second).toBeGreaterThan(first);
    expect(registry.isPendingNavigationCurrent("files-page", first)).toBe(
      false,
    );
    expect(registry.isPendingNavigationCurrent("files-page", second)).toBe(
      true,
    );
    expect(
      registry.takePendingNavigation("files-page", target.uriKey),
    ).toBeNull();
    expect(registry.takePendingNavigation("files-page", "new")).toEqual({
      lineNumber: 4,
      column: 8,
    });
  });

  it("never returns entries belonging to another surface", () => {
    const token = registry.setPendingNavigation("files-page", target);
    for (const surface of ["split-panel", "other", null, undefined]) {
      expect(registry.takePendingNavigation(surface, target.uriKey)).toBeNull();
    }
    expect(registry.isPendingNavigationCurrent("split-panel", token)).toBe(
      false,
    );
    expect(
      registry.takePendingNavigation("files-page", target.uriKey),
    ).not.toBeNull();
  });

  it("expires precisely at ten seconds without extending on open", () => {
    const token = registry.setPendingNavigation("files-page", target);
    vi.advanceTimersByTime(9_999);
    registry.markPendingNavigationOpened("files-page", token);
    expect(registry.isPendingNavigationCurrent("files-page", token)).toBe(true);
    vi.advanceTimersByTime(1);
    expect(
      registry.takePendingNavigation("files-page", target.uriKey),
    ).toBeNull();
    expect(registry.isPendingNavigationCurrent("files-page", token)).toBe(
      false,
    );
  });
});

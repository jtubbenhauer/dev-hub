import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, renderHook } from "@testing-library/react";
import { useLspOpenFileHandler } from "@/hooks/use-lsp-open-file-handler";
import { getLspOpenFileHandler } from "@/lib/lsp/client/navigation-registry";

describe("useLspOpenFileHandler", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(cleanup);

  it.each([
    [false, "a.ts", true, false],
    [true, "a.ts", true, true],
    [true, "b.ts", true, false],
    [true, "a.ts", false, false],
  ])(
    "returns %s with active %s and currency %s",
    async (opened, active, current, expected) => {
      const open = vi.fn(async () => opened);
      renderHook(() => useLspOpenFileHandler("files-page", open, () => active));
      const isCurrent = () => current;

      const result = await getLspOpenFileHandler("files-page")?.(
        "a.ts",
        isCurrent,
      );

      expect(result).toBe(expected);
      expect(open).toHaveBeenCalledWith("a.ts", isCurrent);
    },
  );

  it("uses updated callbacks without replacing registration when rerendered", async () => {
    const first = vi.fn(async () => false);
    const second = vi.fn(async () => true);
    const { rerender, unmount } = renderHook(
      ({ open, active }) =>
        useLspOpenFileHandler("split-panel", open, () => active),
      { initialProps: { open: first, active: "old.ts" } },
    );
    const handler = getLspOpenFileHandler("split-panel");
    rerender({ open: second, active: "a.ts" });

    expect(await handler?.("a.ts", () => true)).toBe(true);
    expect(first).not.toHaveBeenCalled();
    expect(getLspOpenFileHandler("split-panel")).toBe(handler);
    unmount();
    expect(getLspOpenFileHandler("split-panel")).toBeUndefined();
  });

  it("returns false when currency changes while opening", async () => {
    let isCurrent = true;
    const open = async () => {
      isCurrent = false;
      return true;
    };
    renderHook(() => useLspOpenFileHandler("files-page", open, () => "a.ts"));

    expect(
      await getLspOpenFileHandler("files-page")?.("a.ts", () => isCurrent),
    ).toBe(false);
  });
});

import { createRef } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import type { TerminalHandle } from "@/components/terminal/terminal-panel";
import type { NeovimEditorHandle } from "@/components/editor/neovim-editor";

let capturedOnReady: ((handle: TerminalHandle) => void) | undefined;

vi.mock("@/components/terminal/terminal-panel", () => ({
  TerminalPanel: (props: { onReady?: (handle: TerminalHandle) => void }) => {
    capturedOnReady = props.onReady;
    return <div data-testid="terminal-panel" />;
  },
}));

vi.mock("@/hooks/use-settings", () => ({
  useNvimAppNameSetting: () => ({ nvimAppName: "personal", isLoading: false }),
  useTerminalScrollbackSetting: () => ({ scrollback: 5000, isLoading: false }),
  useTerminalFontSetting: () => ({
    terminalFont: "geist-mono" as const,
    isLoading: false,
  }),
  terminalFontFamily: () => "monospace",
}));

vi.stubGlobal(
  "fetch",
  vi.fn((url: string) => {
    const body = url.includes("/api/terminal/resolve")
      ? { wsUrl: "ws://localhost:3001", cwd: "/project", shellCommand: null }
      : { nvim: true };
    return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
  }),
);

import { NeovimEditor } from "@/components/editor/neovim-editor";

function createFakeHandle() {
  return { write: vi.fn(), focus: vi.fn(), blur: vi.fn() };
}

async function renderEditor() {
  const handleRef = createRef<NeovimEditorHandle>();
  render(
    <NeovimEditor
      ref={handleRef}
      content="hello"
      language="typescript"
      onChange={vi.fn()}
      workspaceId="ws-1"
      filePath="src/foo.ts"
    />,
  );
  await waitFor(() => {
    expect(screen.getByTestId("terminal-panel")).toBeInTheDocument();
  });
  return handleRef;
}

describe("NeovimEditor revealLine", () => {
  beforeEach(() => {
    capturedOnReady = undefined;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("jump sequence", () => {
    it("writes escape then :<line> after 50 ms when the terminal is ready", async () => {
      const handleRef = await renderEditor();
      const fakeHandle = createFakeHandle();
      act(() => capturedOnReady?.(fakeHandle));
      await vi.waitFor(() => {
        expect(fakeHandle.write).toHaveBeenCalledWith(":e src/foo.ts\r");
      });
      fakeHandle.write.mockClear();

      vi.useFakeTimers();
      handleRef.current?.revealLine(42);

      expect(fakeHandle.write).toHaveBeenCalledTimes(1);
      expect(fakeHandle.write).toHaveBeenLastCalledWith("\x1b");

      vi.advanceTimersByTime(50);

      expect(fakeHandle.write).toHaveBeenCalledTimes(2);
      expect(fakeHandle.write).toHaveBeenLastCalledWith(":42\r");
    });
  });

  describe("no-op", () => {
    it("does not throw or write when the terminal never became ready", async () => {
      const handleRef = await renderEditor();
      vi.useFakeTimers();

      expect(() => handleRef.current?.revealLine(42)).not.toThrow();
      vi.advanceTimersByTime(100);
    });

    it.each([0, -3, 1.5, Number.NaN])(
      "does not write for invalid line %s",
      async (invalidLine) => {
        const handleRef = await renderEditor();
        const fakeHandle = createFakeHandle();
        act(() => capturedOnReady?.(fakeHandle));
        await vi.waitFor(() => {
          expect(fakeHandle.write).toHaveBeenCalledWith(":e src/foo.ts\r");
        });
        fakeHandle.write.mockClear();

        vi.useFakeTimers();
        handleRef.current?.revealLine(invalidLine);
        vi.advanceTimersByTime(100);

        expect(fakeHandle.write).not.toHaveBeenCalled();
      },
    );
  });
});

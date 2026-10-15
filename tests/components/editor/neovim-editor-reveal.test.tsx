// allow: SIZE_OK — Todo 13 adds the seven delivery scenarios while retaining the revealLine contract tests.
import { createRef, useState } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  waitFor,
  act,
  fireEvent,
} from "@testing-library/react";
import type { TerminalHandle } from "@/components/terminal/terminal-panel";
import type { NeovimEditorHandle } from "@/components/editor/neovim-editor";
import type { EditorRevealRequest } from "@/stores/editor-store";
import { buildNeovimRevealCommand } from "@/components/editor/neovim-reveal-command";

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

describe("NeovimEditor search reveals", () => {
  const request: EditorRevealRequest = {
    id: 7,
    workspaceId: "ws-1",
    path: "a.txt",
    lineNumber: 2,
    startColumn: 3,
    endColumn: 9,
    startByteColumn: 3,
    lineSha256:
      "795c238dcce900c0131e710c25229cc164f8c22b48bb0d5ea3343ad340d91bc4",
  };
  const props = {
    workspaceId: "ws-1",
    content: "",
    language: "text",
    onChange: vi.fn(),
  };
  const command = `:${buildNeovimRevealCommand(request)}\r`;

  afterEach(() => vi.useRealTimers());
  async function setup(revealRequest: EditorRevealRequest | null = null) {
    const handled = vi.fn();
    const view = render(
      <NeovimEditor
        {...props}
        filePath="a.txt"
        revealRequest={revealRequest}
        onRevealHandled={handled}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId("terminal-panel")).toBeInTheDocument(),
    );
    vi.useFakeTimers();
    const handle = createFakeHandle();
    return { view, handle, handled };
  }

  it("delivers one guarded command when a file switch and reveal share a render", async () => {
    // Given
    const { view, handle, handled } = await setup();
    act(() => capturedOnReady?.(handle));
    act(() => vi.advanceTimersByTime(50));
    const next = { ...request, path: "b.txt" };
    handle.write.mockClear();
    // When
    view.rerender(
      <NeovimEditor
        {...props}
        filePath="b.txt"
        revealRequest={next}
        onRevealHandled={handled}
      />,
    );
    expect(handled).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(50));
    // Then
    expect(handle.write.mock.calls).toEqual([
      ["\x1b"],
      [`:${buildNeovimRevealCommand(next)}\r`],
    ]);
    expect(handled).toHaveBeenCalledExactlyOnceWith(next.id);
  });

  it("delivers one guarded command when the terminal becomes ready late", async () => {
    // Given
    const { handle, handled } = await setup(request);
    // When
    act(() => capturedOnReady?.(handle));
    expect(handled).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(50));
    // Then
    expect(handle.write.mock.calls).toEqual([["\x1b"], [command]]);
    expect(handled).toHaveBeenCalledExactlyOnceWith(request.id);
  });

  it("delivers the reveal after the earlier edit when the file is already current", async () => {
    // Given
    const { view, handle, handled } = await setup();
    act(() => capturedOnReady?.(handle));
    act(() => vi.advanceTimersByTime(50));
    // When
    view.rerender(
      <NeovimEditor
        {...props}
        filePath="a.txt"
        revealRequest={request}
        onRevealHandled={handled}
      />,
    );
    expect(handled).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(50));
    // Then
    expect(handle.write.mock.calls).toEqual([
      ["\x1b"],
      [":e a.txt\r"],
      ["\x1b"],
      [command],
    ]);
    expect(handled).toHaveBeenCalledExactlyOnceWith(request.id);
  });

  it("uses the pending switch write when a reveal arrives during its timer", async () => {
    // Given
    const { view, handle, handled } = await setup();
    act(() => capturedOnReady?.(handle));
    // When
    view.rerender(
      <NeovimEditor
        {...props}
        filePath="a.txt"
        revealRequest={request}
        onRevealHandled={handled}
      />,
    );
    act(() => vi.advanceTimersByTime(50));
    // Then
    expect(handle.write.mock.calls).toEqual([["\x1b"], [command]]);
    expect(handled).toHaveBeenCalledExactlyOnceWith(request.id);
  });

  it("falls back to the plain edit when a switched path contains a control character", async () => {
    // Given
    const { view, handle, handled } = await setup();
    act(() => capturedOnReady?.(handle));
    act(() => vi.advanceTimersByTime(50));
    handle.write.mockClear();
    const invalid = { ...request, path: "bad\npath.txt" };
    // When
    view.rerender(
      <NeovimEditor
        {...props}
        filePath={invalid.path}
        revealRequest={invalid}
        onRevealHandled={handled}
      />,
    );
    act(() => vi.advanceTimersByTime(50));
    // Then
    expect(handle.write.mock.calls).toEqual([
      ["\x1b"],
      [`:e ${invalid.path}\r`],
    ]);
    expect(handled).toHaveBeenCalledExactlyOnceWith(invalid.id);
  });

  it("writes nothing when a request targets another path", async () => {
    // Given
    const { view, handle, handled } = await setup();
    act(() => capturedOnReady?.(handle));
    act(() => vi.advanceTimersByTime(50));
    handle.write.mockClear();
    // When
    view.rerender(
      <NeovimEditor
        {...props}
        filePath="a.txt"
        revealRequest={{ ...request, path: "b.txt" }}
        onRevealHandled={handled}
      />,
    );
    act(() => vi.advanceTimersByTime(50));
    // Then
    expect(handle.write).not.toHaveBeenCalled();
    expect(handled).not.toHaveBeenCalled();
  });

  it("writes the command before acknowledgement clears the request", async () => {
    // Given
    const handled = vi.fn();
    function Parent() {
      const [pending, setPending] = useState<EditorRevealRequest | null>(null);
      return (
        <>
          <button onClick={() => setPending(request)}>Reveal</button>
          <NeovimEditor
            {...props}
            filePath="a.txt"
            revealRequest={pending}
            onRevealHandled={(id) => {
              handled(id);
              setPending(null);
            }}
          />
        </>
      );
    }
    render(<Parent />);
    await waitFor(() =>
      expect(screen.getByTestId("terminal-panel")).toBeInTheDocument(),
    );
    vi.useFakeTimers();
    const handle = createFakeHandle();
    act(() => capturedOnReady?.(handle));
    act(() => vi.advanceTimersByTime(50));
    // When
    fireEvent.click(screen.getByText("Reveal"));
    expect(handled).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(50));
    // Then
    expect(handle.write.mock.calls).toEqual([
      ["\x1b"],
      [":e a.txt\r"],
      ["\x1b"],
      [command],
    ]);
    expect(handled).toHaveBeenCalledExactlyOnceWith(request.id);
  });
});

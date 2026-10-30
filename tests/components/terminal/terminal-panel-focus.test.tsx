import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor, screen } from "@testing-library/react";

// jsdom does not provide ResizeObserver
class StubResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", StubResizeObserver);

const mockFocus = vi.fn();
const mockBlur = vi.fn();
const mockDispose = vi.fn();
const mockLoadAddon = vi.fn();
const mockOpen = vi.fn();
const mockWrite = vi.fn();
const mockWriteln = vi.fn();
const mockReset = vi.fn();
const mockClear = vi.fn();

let mockOnDataCb: ((data: string) => void) | null = null;
let mockKeyHandler: ((event: KeyboardEvent) => boolean) | null = null;
let capturedTerminalOptions: Record<string, unknown> | null = null;
let capturedLinkHandler: unknown = null;

const mockTerminal = {
  cols: 80,
  rows: 24,
  options: {} as Record<string, unknown>,
  focus: mockFocus,
  blur: mockBlur,
  dispose: mockDispose,
  loadAddon: mockLoadAddon,
  open: mockOpen,
  write: mockWrite,
  writeln: mockWriteln,
  reset: mockReset,
  clear: mockClear,
  getSelection: vi.fn(() => "selected text"),
  attachCustomKeyEventHandler: vi.fn(
    (handler: (event: KeyboardEvent) => boolean) => {
      mockKeyHandler = handler;
    },
  ),
  onData: vi.fn((cb: (data: string) => void) => {
    mockOnDataCb = cb;
    return { dispose: vi.fn() };
  }),
  onBinary: vi.fn(() => ({ dispose: vi.fn() })),
  onResize: vi.fn(() => ({ dispose: vi.fn() })),
};

vi.mock("@xterm/xterm", () => ({
  Terminal: function MockTerminal(options: Record<string, unknown>) {
    capturedTerminalOptions = options;
    return mockTerminal;
  },
}));

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: function MockFitAddon() {
    return { fit: vi.fn() };
  },
}));

vi.mock("@xterm/addon-web-links", () => ({
  WebLinksAddon: function MockWebLinksAddon(handler: unknown) {
    capturedLinkHandler = handler;
  },
}));

vi.mock("@xterm/addon-search", () => ({
  SearchAddon: function MockSearchAddon() {
    return {
      findNext: vi.fn(() => true),
      findPrevious: vi.fn(() => true),
      clearDecorations: vi.fn(),
    };
  },
}));

class MockWebSocket {
  static OPEN = 1;
  static CLOSED = 3;
  static instances: MockWebSocket[] = [];
  readyState = MockWebSocket.OPEN;
  binaryType = "blob";
  url: string;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  send = vi.fn();
  close = vi.fn();

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }
}

vi.stubGlobal("WebSocket", MockWebSocket);

const mockFetch = vi.fn(() =>
  Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ token: "socket-token" }),
  }),
);
vi.stubGlobal("fetch", mockFetch);

// document.fonts is not available in jsdom
Object.defineProperty(document, "fonts", {
  value: {
    load: vi.fn().mockResolvedValue([]),
    ready: Promise.resolve(),
  },
  configurable: true,
});

import { TerminalPanel } from "@/components/terminal/terminal-panel";
import { openTerminalLink } from "@/lib/terminal/terminal-links";
import {
  SESSION_REPLACED_CLOSE_CODE,
  SESSION_ENDED_CLOSE_CODE,
} from "@/lib/terminal/terminal-protocol";

function latestSocket(): MockWebSocket {
  const socket = MockWebSocket.instances.at(-1);
  if (!socket) throw new Error("No WebSocket was opened");
  return socket;
}

async function renderPanel(
  props: Partial<Parameters<typeof TerminalPanel>[0]> = {},
) {
  const result = render(
    <TerminalPanel
      wsUrl="ws://localhost:3001/ws"
      workspaceId="ws-1"
      cwd="/project"
      shellCommand="nvim test.ts"
      autoFocus
      {...props}
    />,
  );
  await waitFor(() => expect(MockWebSocket.instances.length).toBe(1));
  return result;
}

async function renderConnectedTerminal() {
  const result = await renderPanel();
  latestSocket().onopen?.();
  await waitFor(() => {
    expect(mockFocus).toHaveBeenCalled();
  });
  mockFocus.mockClear();
  return result;
}

beforeEach(() => {
  vi.clearAllMocks();
  MockWebSocket.instances = [];
  mockOnDataCb = null;
  mockKeyHandler = null;
  capturedTerminalOptions = null;
  capturedLinkHandler = null;
});

describe("TerminalPanel focus restoration", () => {
  it("focuses terminal on initial connection when autoFocus is true", async () => {
    await renderPanel();
    latestSocket().onopen?.();
    await waitFor(() => {
      expect(mockFocus).toHaveBeenCalled();
    });
  });

  it("does not focus terminal on initial connection when autoFocus is false", async () => {
    await renderPanel({ autoFocus: false });
    latestSocket().onopen?.();
    expect(mockFocus).not.toHaveBeenCalled();
  });

  it("re-focuses terminal on wheel event over the container", async () => {
    const { container } = await renderConnectedTerminal();
    const terminalContainer = container.querySelector(".min-h-0.flex-1.p-1");
    expect(terminalContainer).not.toBeNull();
    fireEvent.wheel(terminalContainer!, { deltaY: 100 });
    expect(mockFocus).toHaveBeenCalledTimes(1);
  });

  it("re-focuses terminal on repeated wheel events", async () => {
    const { container } = await renderConnectedTerminal();
    const terminalContainer = container.querySelector(".min-h-0.flex-1.p-1");
    fireEvent.wheel(terminalContainer!, { deltaY: 100 });
    fireEvent.wheel(terminalContainer!, { deltaY: 100 });
    fireEvent.wheel(terminalContainer!, { deltaY: 100 });
    expect(mockFocus).toHaveBeenCalledTimes(3);
  });

  it("re-focuses terminal on mousedown on the container padding area", async () => {
    const { container } = await renderConnectedTerminal();
    const terminalContainer = container.querySelector(".min-h-0.flex-1.p-1");
    fireEvent.mouseDown(terminalContainer!, { target: terminalContainer });
    expect(mockFocus).toHaveBeenCalledTimes(1);
  });

  it("does not re-focus on mousedown on xterm canvas (child element)", async () => {
    const { container } = await renderConnectedTerminal();
    const terminalContainer = container.querySelector(".min-h-0.flex-1.p-1");
    const childEl = document.createElement("div");
    terminalContainer!.appendChild(childEl);
    fireEvent.mouseDown(childEl);
    expect(mockFocus).not.toHaveBeenCalled();
  });
});

describe("TerminalPanel connection", () => {
  it("authorizes the socket with a fresh token and the idle timeout", async () => {
    await renderPanel({ sessionId: "term-1", idleTimeoutMinutes: 30 });
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/terminal/token?workspaceId=ws-1",
    );
    const url = new URL(latestSocket().url);
    expect(url.searchParams.get("token")).toBe("socket-token");
    expect(url.searchParams.get("sessionId")).toBe("term-1");
    expect(url.searchParams.get("idleTimeoutMinutes")).toBe("30");
    expect(latestSocket().binaryType).toBe("arraybuffer");
  });

  it("sends keystrokes as binary frames and writes binary output", async () => {
    await renderPanel();
    const socket = latestSocket();
    socket.onopen?.();
    mockOnDataCb?.('{"type":"resize","cols":1,"rows":1}');
    const sent = socket.send.mock.calls[0][0] as Uint8Array;
    expect(ArrayBuffer.isView(sent)).toBe(true);
    expect(new TextDecoder().decode(sent)).toBe(
      '{"type":"resize","cols":1,"rows":1}',
    );

    const output = Uint8Array.from("hello", (c) => c.charCodeAt(0)).buffer;
    socket.onmessage?.({ data: output });
    expect(mockWrite).toHaveBeenCalledWith(new Uint8Array(output));
  });

  it("resets the screen when a socket opens so the snapshot is not duplicated", async () => {
    await renderPanel();
    latestSocket().onopen?.();
    expect(mockReset).toHaveBeenCalledTimes(1);
  });

  it("reconnects automatically after an unexpected close", async () => {
    await renderPanel();
    latestSocket().onopen?.();
    latestSocket().onclose?.({ code: 1006 });
    expect(
      await screen.findByText("Connection lost. Reconnecting..."),
    ).toBeInTheDocument();
    await waitFor(() => expect(MockWebSocket.instances.length).toBe(2), {
      timeout: 2000,
    });
  });

  it("does not reconnect after the process exits and offers a restart", async () => {
    await renderPanel();
    const socket = latestSocket();
    socket.onopen?.();
    socket.onmessage?.({ data: JSON.stringify({ type: "exit", exitCode: 0 }) });
    socket.onclose?.({ code: 1000 });
    expect(await screen.findByText("Process exited")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Restart" }));
    await waitFor(() => expect(MockWebSocket.instances.length).toBe(2));
  });

  it.each([
    [SESSION_REPLACED_CLOSE_CODE, "This session is open in another window"],
    [SESSION_ENDED_CLOSE_CODE, "Session ended"],
  ])("does not reconnect when closed with code %i", async (code, label) => {
    await renderPanel();
    latestSocket().onopen?.();
    latestSocket().onclose?.({ code });
    expect(await screen.findByText(label)).toBeInTheDocument();
    expect(MockWebSocket.instances.length).toBe(1);
  });

  it("does not reconnect after a fatal server error", async () => {
    await renderPanel();
    const socket = latestSocket();
    socket.onmessage?.({
      data: JSON.stringify({
        type: "error",
        data: "Origin not allowed",
        isFatal: true,
      }),
    });
    socket.onclose?.({ code: 1008 });
    expect(
      await screen.findByText("Connection error: Origin not allowed"),
    ).toBeInTheDocument();
    expect(MockWebSocket.instances.length).toBe(1);
  });
});

describe("TerminalPanel links and shortcuts", () => {
  it("disables option-click cursor moves and requires Cmd/Ctrl for links", async () => {
    await renderPanel();
    expect(capturedTerminalOptions?.altClickMovesCursor).toBe(false);
    expect(capturedLinkHandler).toBe(openTerminalLink);
  });

  it("opens search on Cmd+F and clears on Cmd+K when shell features are on", async () => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    await renderPanel({ hasShellFeatures: true });
    latestSocket().onopen?.();

    const cmdF = new KeyboardEvent("keydown", { key: "f", metaKey: true });
    expect(mockKeyHandler?.(cmdF)).toBe(false);
    expect(
      await screen.findByLabelText("Find in terminal"),
    ).toBeInTheDocument();

    const cmdK = new KeyboardEvent("keydown", { key: "k", metaKey: true });
    expect(mockKeyHandler?.(cmdK)).toBe(false);
    expect(mockClear).toHaveBeenCalled();
    expect(latestSocket().send).toHaveBeenCalledWith(
      JSON.stringify({ type: "clear" }),
    );
  });

  it("leaves Cmd+F alone for editor terminals", async () => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    await renderPanel();
    const cmdF = new KeyboardEvent("keydown", { key: "f", metaKey: true });
    expect(mockKeyHandler?.(cmdF)).toBe(true);
  });
});

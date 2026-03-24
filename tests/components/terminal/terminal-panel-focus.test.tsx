import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";

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

let _mockOnDataCb: ((data: string) => void) | null = null;
let _mockOnBinaryCb: ((data: string) => void) | null = null;
let _mockOnResizeCb: ((size: { cols: number; rows: number }) => void) | null =
  null;

const mockTerminal = {
  cols: 80,
  rows: 24,
  focus: mockFocus,
  blur: mockBlur,
  dispose: mockDispose,
  loadAddon: mockLoadAddon,
  open: mockOpen,
  write: mockWrite,
  writeln: mockWriteln,
  onData: vi.fn((cb: (data: string) => void) => {
    _mockOnDataCb = cb;
    return { dispose: vi.fn() };
  }),
  onBinary: vi.fn((cb: (data: string) => void) => {
    _mockOnBinaryCb = cb;
    return { dispose: vi.fn() };
  }),
  onResize: vi.fn((cb: (size: { cols: number; rows: number }) => void) => {
    _mockOnResizeCb = cb;
    return { dispose: vi.fn() };
  }),
};

vi.mock("@xterm/xterm", () => ({
  Terminal: function MockTerminal() {
    return mockTerminal;
  },
}));

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: function MockFitAddon() {
    return { fit: vi.fn() };
  },
}));

vi.mock("@xterm/addon-web-links", () => ({
  WebLinksAddon: function MockWebLinksAddon() {},
}));

let capturedWsOnOpen: (() => void) | null = null;
let _capturedWsOnMessage: ((event: { data: string }) => void) | null = null;

class MockWebSocket {
  static OPEN = 1;
  static CLOSED = 3;
  readyState = MockWebSocket.OPEN;
  url: string;

  constructor(url: string) {
    this.url = url;
    // Simulate async open
    setTimeout(() => capturedWsOnOpen?.(), 0);
  }

  set onopen(cb: () => void) {
    capturedWsOnOpen = cb;
  }

  set onmessage(cb: (event: { data: string }) => void) {
    _capturedWsOnMessage = cb;
  }

  set onclose(_cb: () => void) {}
  set onerror(_cb: () => void) {}

  send = vi.fn();
  close = vi.fn();
}

vi.stubGlobal("WebSocket", MockWebSocket);

// document.fonts is not available in jsdom
Object.defineProperty(document, "fonts", {
  value: {
    load: vi.fn().mockResolvedValue([]),
    ready: Promise.resolve(),
  },
  configurable: true,
});

import { TerminalPanel } from "@/components/terminal/terminal-panel";

describe("TerminalPanel focus restoration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _mockOnDataCb = null;
    _mockOnBinaryCb = null;
    _mockOnResizeCb = null;
    capturedWsOnOpen = null;
    _capturedWsOnMessage = null;
  });

  async function renderConnectedTerminal() {
    const result = render(
      <TerminalPanel
        wsUrl="ws://localhost:3001/ws"
        workspaceId="ws-1"
        cwd="/project"
        shellCommand="nvim test.ts"
        autoFocus
      />,
    );

    // Wait for async font load + WebSocket connect
    await waitFor(() => {
      expect(mockOpen).toHaveBeenCalled();
    });

    // Simulate WebSocket open
    capturedWsOnOpen?.();

    await waitFor(() => {
      expect(mockFocus).toHaveBeenCalled();
    });

    mockFocus.mockClear();

    return result;
  }

  it("focuses terminal on initial connection when autoFocus is true", async () => {
    render(
      <TerminalPanel
        wsUrl="ws://localhost:3001/ws"
        workspaceId="ws-1"
        cwd="/project"
        shellCommand="nvim test.ts"
        autoFocus
      />,
    );

    await waitFor(() => {
      expect(mockOpen).toHaveBeenCalled();
    });

    capturedWsOnOpen?.();

    await waitFor(() => {
      expect(mockFocus).toHaveBeenCalled();
    });
  });

  it("does not focus terminal on initial connection when autoFocus is false", async () => {
    render(
      <TerminalPanel
        wsUrl="ws://localhost:3001/ws"
        workspaceId="ws-1"
        cwd="/project"
        shellCommand="nvim test.ts"
        autoFocus={false}
      />,
    );

    await waitFor(() => {
      expect(mockOpen).toHaveBeenCalled();
    });

    capturedWsOnOpen?.();

    // Give time for any focus call to happen
    await new Promise((r) => setTimeout(r, 10));

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

    // mousedown directly on the container (not a child) triggers refocus
    fireEvent.mouseDown(terminalContainer!, {
      target: terminalContainer,
    });

    expect(mockFocus).toHaveBeenCalledTimes(1);
  });

  it("does not re-focus on mousedown on xterm canvas (child element)", async () => {
    const { container } = await renderConnectedTerminal();

    const terminalContainer = container.querySelector(".min-h-0.flex-1.p-1");
    // xterm.js creates child elements inside the container — simulate
    // a mousedown on a child (target !== currentTarget means no refocus)
    const childEl = document.createElement("div");
    terminalContainer!.appendChild(childEl);

    // Fire on child — it bubbles to container, but target is the child
    fireEvent.mouseDown(childEl);

    expect(mockFocus).not.toHaveBeenCalled();
  });
});

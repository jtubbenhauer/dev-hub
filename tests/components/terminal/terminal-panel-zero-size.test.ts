import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";

const xtermMocks = vi.hoisted(() => ({
  fit: vi.fn(),
  openedContainers: [] as HTMLElement[],
}));

vi.mock("@xterm/xterm", () => ({
  Terminal: function MockTerminal() {
    return {
      cols: 80,
      rows: 24,
      options: {},
      open: (container: HTMLElement) =>
        xtermMocks.openedContainers.push(container),
      loadAddon: vi.fn(),
      attachCustomKeyEventHandler: vi.fn(),
      onData: vi.fn(),
      onBinary: vi.fn(),
      onResize: vi.fn(),
      focus: vi.fn(),
      dispose: vi.fn(),
    };
  },
}));

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: function MockFitAddon() {
    return { fit: xtermMocks.fit };
  },
}));

vi.mock("@xterm/addon-web-links", () => ({
  WebLinksAddon: function MockWebLinksAddon() {},
}));

vi.mock("@xterm/addon-search", () => ({
  SearchAddon: function MockSearchAddon() {
    return { clearDecorations: vi.fn() };
  },
}));

// The token request never settles, so no socket opens during these tests.
vi.stubGlobal(
  "fetch",
  vi.fn(() => new Promise<never>(() => {})),
);

Object.defineProperty(document, "fonts", {
  value: { load: vi.fn().mockResolvedValue([]), ready: Promise.resolve() },
  configurable: true,
});

import {
  shouldFitTerminal,
  TerminalPanel,
} from "@/components/terminal/terminal-panel";

interface ElementSize {
  readonly width: number;
  readonly height: number;
}

function createSizedElement(size: ElementSize): HTMLElement {
  const element = document.createElement("div");
  Object.defineProperty(element, "clientWidth", { value: size.width });
  Object.defineProperty(element, "clientHeight", { value: size.height });
  return element;
}

function giveEveryElementSize(size: ElementSize) {
  vi.spyOn(Element.prototype, "clientWidth", "get").mockReturnValue(size.width);
  vi.spyOn(Element.prototype, "clientHeight", "get").mockReturnValue(
    size.height,
  );
}

async function renderTerminalPanel(): Promise<HTMLElement> {
  render(
    createElement(TerminalPanel, {
      wsUrl: "ws://127.0.0.1:7600",
      workspaceId: "ws-1",
      cwd: "/repo",
      shellCommand: null,
    }),
  );
  await waitFor(() => expect(xtermMocks.openedContainers).toHaveLength(1));
  const [container] = xtermMocks.openedContainers;
  if (!container) throw new Error("xterm was never opened");
  return container;
}

beforeEach(() => {
  xtermMocks.fit.mockClear();
  xtermMocks.openedContainers.length = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("shouldFitTerminal", () => {
  it("rejects a missing container", () => {
    expect(shouldFitTerminal(null)).toBe(false);
  });

  it.each([
    [0, 0],
    [800, 0],
    [0, 600],
  ])("rejects a %i x %i container", (width, height) => {
    expect(shouldFitTerminal(createSizedElement({ width, height }))).toBe(
      false,
    );
  });

  it("accepts an 800 x 600 container", () => {
    expect(
      shouldFitTerminal(createSizedElement({ width: 800, height: 600 })),
    ).toBe(true);
  });
});

describe("TerminalPanel in a hidden (zero-size) container", () => {
  it("skips the initial fit", async () => {
    // When
    await renderTerminalPanel();

    // Then
    expect(xtermMocks.fit).not.toHaveBeenCalled();
  });

  it("skips a window resize while the container has no size", async () => {
    // Given
    await renderTerminalPanel();

    // When
    window.dispatchEvent(new Event("resize"));

    // Then
    expect(xtermMocks.fit).not.toHaveBeenCalled();
  });

  it("fits on a window resize once the container has a size", async () => {
    // Given
    await renderTerminalPanel();
    giveEveryElementSize({ width: 800, height: 600 });

    // When
    window.dispatchEvent(new Event("resize"));

    // Then
    expect(xtermMocks.fit).toHaveBeenCalledOnce();
  });

  it("fits on open when the container already has a size", async () => {
    // Given
    giveEveryElementSize({ width: 800, height: 600 });

    // When
    await renderTerminalPanel();

    // Then
    expect(xtermMocks.fit).toHaveBeenCalledOnce();
  });
});

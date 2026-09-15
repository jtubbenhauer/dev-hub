import "@testing-library/jest-dom/vitest";

// Global test setup — runs before every test file

// EventSource is not available in jsdom; provide a minimal stub so the store
// can construct and interact with it without crashing.
class MockEventSource {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;

  readyState: number = MockEventSource.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(public url: string) {}

  close() {
    this.readyState = MockEventSource.CLOSED;
  }

  // Test helper — simulate the connection opening
  simulateOpen() {
    this.readyState = MockEventSource.OPEN;
    this.onopen?.();
  }

  // Test helper — dispatch a raw SSE data string
  simulateMessage(data: string) {
    this.onmessage?.({ data } as MessageEvent);
  }

  // Test helper — simulate a connection error
  simulateError() {
    this.readyState = MockEventSource.CLOSED;
    this.onerror?.();
  }
}

Object.defineProperty(globalThis, "EventSource", {
  value: MockEventSource,
  writable: true,
});

// requestAnimationFrame is not available in jsdom — shim it to run synchronously
// so RAF-batched store updates (e.g. message.part.updated) flush immediately in tests.
globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => {
  cb(performance.now());
  return 0;
};
globalThis.cancelAnimationFrame = () => {};

if (typeof Element !== "undefined") {
  Element.prototype.scrollIntoView = function scrollIntoView() {};
}

// ResizeObserver is not available in jsdom — Radix ScrollArea constructs one in
// a layout effect. Provide a no-op stub so components that render inside a
// ScrollArea can mount in tests.
class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

Object.defineProperty(globalThis, "ResizeObserver", {
  value: MockResizeObserver,
  writable: true,
  configurable: true,
});

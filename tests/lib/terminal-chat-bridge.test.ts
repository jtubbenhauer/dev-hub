import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  appendToComposerText,
  formatTerminalOutputForChat,
  MAX_TERMINAL_OUTPUT_CHARS,
  queueTerminalOutputForChat,
  takePendingTerminalOutput,
  TERMINAL_OUTPUT_TO_CHAT_EVENT,
} from "@/lib/terminal-chat-bridge";

beforeEach(() => {
  localStorage.clear();
});

describe("formatTerminalOutputForChat", () => {
  it("wraps output in a labelled text fence", () => {
    expect(formatTerminalOutputForChat("error: boom\n\n", "Terminal 2")).toBe(
      "Terminal output (Terminal 2):\n```text\nerror: boom\n```",
    );
  });

  it("uses a longer fence when the output contains backticks", () => {
    const formatted = formatTerminalOutputForChat("```js\nx\n```", "T");
    expect(formatted.split("\n")[1]).toBe("````text");
    expect(formatted.endsWith("\n````")).toBe(true);
  });

  it("keeps only the most recent output when it is very long", () => {
    const output = `${"a".repeat(MAX_TERMINAL_OUTPUT_CHARS)}TAIL`;
    const formatted = formatTerminalOutputForChat(output, "T");
    expect(formatted).toContain("[... earlier output truncated ...]");
    expect(formatted).toContain("TAIL");
    expect(formatted.length).toBeLessThan(MAX_TERMINAL_OUTPUT_CHARS + 100);
  });
});

describe("appendToComposerText", () => {
  it("replaces an empty draft and appends to an existing one", () => {
    expect(appendToComposerText("  ", "snippet")).toBe("snippet");
    expect(appendToComposerText("Why does this fail?\n", "snippet")).toBe(
      "Why does this fail?\n\nsnippet",
    );
  });
});

describe("pending terminal output", () => {
  it("queues output per workspace, notifies listeners, and is taken once", () => {
    const listener = vi.fn();
    window.addEventListener(TERMINAL_OUTPUT_TO_CHAT_EVENT, listener);
    queueTerminalOutputForChat("ws-1", "first");
    queueTerminalOutputForChat("ws-1", "second");
    window.removeEventListener(TERMINAL_OUTPUT_TO_CHAT_EVENT, listener);

    expect(listener).toHaveBeenCalledTimes(2);
    expect(takePendingTerminalOutput("ws-2")).toBeNull();
    expect(takePendingTerminalOutput("ws-1")).toBe("first\n\nsecond");
    expect(takePendingTerminalOutput("ws-1")).toBeNull();
  });
});

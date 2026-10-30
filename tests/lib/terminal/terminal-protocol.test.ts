import { describe, expect, it, vi } from "vitest";
import {
  parseClientMessage,
  parseIdleTimeoutMs,
  parseServerMessage,
  SESSION_ENDED_CLOSE_CODE,
  SESSION_REPLACED_CLOSE_CODE,
} from "@/lib/terminal/terminal-protocol";
import {
  classifySocketClose,
  matchTerminalShortcut,
  MAX_RECONNECT_ATTEMPTS,
  reconnectDelayMs,
} from "@/lib/terminal/terminal-client-utils";
import { openTerminalLink } from "@/lib/terminal/terminal-links";

describe("terminal protocol parsing", () => {
  it("parses server control messages", () => {
    expect(parseServerMessage('{"type":"exit","exitCode":2}')).toEqual({
      type: "exit",
      exitCode: 2,
    });
    expect(
      parseServerMessage('{"type":"error","data":"nope","isFatal":true}'),
    ).toEqual({ type: "error", data: "nope", isFatal: true });
    expect(parseServerMessage('{"type":"other"}')).toBeNull();
    expect(parseServerMessage("not json")).toBeNull();
  });

  it("accepts only well-formed client control messages", () => {
    expect(
      parseClientMessage('{"type":"resize","cols":120,"rows":40}'),
    ).toEqual({ type: "resize", cols: 120, rows: 40 });
    expect(parseClientMessage('{"type":"clear"}')).toEqual({ type: "clear" });
    expect(
      parseClientMessage('{"type":"resize","cols":0,"rows":40}'),
    ).toBeNull();
    expect(
      parseClientMessage('{"type":"resize","cols":1.5,"rows":4}'),
    ).toBeNull();
    expect(parseClientMessage("[1,2]")).toBeNull();
  });

  it("parses the idle timeout in minutes, with 0 meaning never", () => {
    expect(parseIdleTimeoutMs("0")).toBeNull();
    expect(parseIdleTimeoutMs("15")).toBe(15 * 60 * 1000);
    expect(parseIdleTimeoutMs(null)).toBe(5 * 60 * 1000);
    expect(parseIdleTimeoutMs("abc")).toBe(5 * 60 * 1000);
    expect(parseIdleTimeoutMs("-3")).toBe(5 * 60 * 1000);
  });
});

describe("reconnect policy", () => {
  it("backs off exponentially up to a cap", () => {
    expect(reconnectDelayMs(0)).toBe(500);
    expect(reconnectDelayMs(1)).toBe(1000);
    expect(reconnectDelayMs(3)).toBe(4000);
    expect(reconnectDelayMs(10)).toBe(10_000);
  });

  it.each([
    [
      { closeCode: 1006, hasExited: false, hasFatalError: false, attempt: 0 },
      "reconnect",
    ],
    [
      { closeCode: 1000, hasExited: true, hasFatalError: false, attempt: 0 },
      "exited",
    ],
    [
      { closeCode: 1008, hasExited: false, hasFatalError: true, attempt: 0 },
      "fatal",
    ],
    [
      {
        closeCode: SESSION_REPLACED_CLOSE_CODE,
        hasExited: false,
        hasFatalError: false,
        attempt: 0,
      },
      "replaced",
    ],
    [
      {
        closeCode: SESSION_ENDED_CLOSE_CODE,
        hasExited: false,
        hasFatalError: false,
        attempt: 0,
      },
      "ended",
    ],
    [
      {
        closeCode: 1006,
        hasExited: false,
        hasFatalError: false,
        attempt: MAX_RECONNECT_ATTEMPTS,
      },
      "give-up",
    ],
  ] as const)("classifies %o as %s", (input, outcome) => {
    expect(classifySocketClose(input)).toBe(outcome);
  });
});

describe("terminal shortcuts", () => {
  const key = (init: KeyboardEventInit) => new KeyboardEvent("keydown", init);

  it("uses Cmd on macOS", () => {
    expect(matchTerminalShortcut(key({ key: "f", metaKey: true }), true)).toBe(
      "search",
    );
    expect(matchTerminalShortcut(key({ key: "k", metaKey: true }), true)).toBe(
      "clear",
    );
    expect(
      matchTerminalShortcut(key({ key: "f", ctrlKey: true }), true),
    ).toBeNull();
  });

  it("uses Ctrl+Shift elsewhere so readline's Ctrl+F/K keep working", () => {
    expect(
      matchTerminalShortcut(
        key({ key: "F", ctrlKey: true, shiftKey: true }),
        false,
      ),
    ).toBe("search");
    expect(
      matchTerminalShortcut(key({ key: "k", ctrlKey: true }), false),
    ).toBeNull();
  });

  it("ignores keyup events", () => {
    const keyup = new KeyboardEvent("keyup", { key: "f", metaKey: true });
    expect(matchTerminalShortcut(keyup, true)).toBeNull();
  });
});

describe("openTerminalLink", () => {
  it.each([
    ["plain click", {}, false],
    ["option click", { altKey: true }, false],
    ["cmd click", { metaKey: true }, true],
    ["ctrl click", { ctrlKey: true }, true],
  ])("%s opens the link: %s", (_label, modifiers, shouldOpen) => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    openTerminalLink(new MouseEvent("click", modifiers), "https://example.com");
    if (shouldOpen) {
      expect(open).toHaveBeenCalledWith(
        "https://example.com",
        "_blank",
        "noopener,noreferrer",
      );
    } else {
      expect(open).not.toHaveBeenCalled();
    }
    open.mockRestore();
  });
});

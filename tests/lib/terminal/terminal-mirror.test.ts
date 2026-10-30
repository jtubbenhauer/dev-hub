// @vitest-environment node
import { describe, expect, it } from "vitest";
import { TerminalMirror } from "@/lib/terminal/terminal-mirror";

describe("TerminalMirror", () => {
  it("snapshots everything written before the snapshot was requested", async () => {
    const mirror = new TerminalMirror(80, 24, 100);
    mirror.write("\x1b[31mred line\x1b[0m\r\n");
    mirror.write("plain line\r\n");
    const snapshot = await mirror.snapshot();
    expect(snapshot).toContain("red line");
    expect(snapshot).toContain("plain line");
    expect(snapshot).toMatch(/\x1b\[31m/);
    mirror.dispose();
  });

  it("restores the alternate screen used by full-screen programs", async () => {
    const mirror = new TerminalMirror(80, 24, 100);
    mirror.write("shell output\r\n");
    mirror.write("\x1b[?1049h\x1b[Hfull screen app");
    const snapshot = await mirror.snapshot();
    expect(snapshot).toContain("\x1b[?1049h");
    expect(snapshot).toContain("full screen app");
    mirror.dispose();
  });

  it("drops scrollback when cleared", async () => {
    const mirror = new TerminalMirror(80, 5, 100);
    for (let i = 0; i < 20; i++) mirror.write(`line-${i}\r\n`);
    mirror.clear();
    const snapshot = await mirror.snapshot();
    expect(snapshot).not.toContain("line-3\r\n");
    mirror.dispose();
  });
});

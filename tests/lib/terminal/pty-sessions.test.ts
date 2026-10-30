import { describe, expect, it } from "vitest";
import { buildEnv } from "@/lib/terminal/pty-sessions";

describe("buildEnv", () => {
  it("advertises a colour-capable terminal to child processes", () => {
    const env = buildEnv();
    expect(env.TERM).toBe("xterm-256color");
    expect(env.COLORTERM).toBe("truecolor");
    expect(env.CLICOLOR).toBe("1");
  });

  it("lets caller overrides win over the colour defaults", () => {
    const env = buildEnv({ COLORTERM: "", CLICOLOR: "0" });
    expect(env.COLORTERM).toBe("");
    expect(env.CLICOLOR).toBe("0");
  });
});

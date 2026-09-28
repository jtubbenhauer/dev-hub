import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

describe("omo smoke script", () => {
  it("prints SKIPPED and exits successfully when the omo binary is unavailable", async () => {
    const { stdout } = await execFileAsync(
      "pnpm",
      ["exec", "tsx", "scripts/omo-smoke.ts"],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          OMO_BIN: join(process.cwd(), ".test-missing-binaries", "omo-smoke"),
        },
      },
    );

    expect(stdout.trim()).toBe("SKIPPED: omo binary is not available");
  });
});

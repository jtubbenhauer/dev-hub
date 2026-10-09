import { execFileSync } from "node:child_process";

export function isProcessLive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    const state = execFileSync("ps", ["-o", "stat=", "-p", String(pid)], {
      encoding: "utf8",
    }).trim();
    return !state.startsWith("Z");
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    return false;
  }
}

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const NVIM_BIN = "nvim";
const EXEC_TIMEOUT_MS = 5_000;

export async function isNvimInstalled(): Promise<boolean> {
  try {
    await execFileAsync(NVIM_BIN, ["--version"], { timeout: EXEC_TIMEOUT_MS });
    return true;
  } catch (err) {
    const error = err as { code?: string };
    if (typeof error.code === "string" && error.code === "ENOENT") return false;
    // Non-ENOENT errors mean the binary exists but something else went wrong
    return true;
  }
}

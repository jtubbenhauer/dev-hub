import { execFile } from "node:child_process";
import type { Systeminformation } from "systeminformation";

export function readDarwinVmStat(): Promise<string | null> {
  if (process.platform !== "darwin") return Promise.resolve(null);
  return new Promise((resolve) => {
    execFile("vm_stat", (error, stdout) => resolve(error ? null : stdout));
  });
}

// Activity Monitor's "Memory Used": app memory (anonymous minus purgeable
// pages) + wired + compressed. Cached files are reclaimable, so not counted.
function darwinUsedMemoryBytes(vmStat: string): number | null {
  const pageSize = vmStat.match(/page size of (\d+) bytes/)?.[1];
  const pageCounts = new Map<string, number>();
  for (const line of vmStat.split("\n")) {
    const match = line.match(/^(.+?):\s+(\d+)\.$/);
    if (match) pageCounts.set(match[1], Number(match[2]));
  }
  const anonymous = pageCounts.get("Anonymous pages");
  const purgeable = pageCounts.get("Pages purgeable");
  const wired = pageCounts.get("Pages wired down");
  const compressed = pageCounts.get("Pages occupied by compressor");
  if (
    pageSize === undefined ||
    anonymous === undefined ||
    purgeable === undefined ||
    wired === undefined ||
    compressed === undefined
  ) {
    return null;
  }
  return (anonymous - purgeable + wired + compressed) * Number(pageSize);
}

// `total - free` counts reclaimable file cache as used. systeminformation's
// `available` excludes it on Linux/Windows, but on macOS it only counts active
// pages, so macOS uses the vm_stat breakdown instead.
export function calculateUsedMemoryBytes(
  mem: Pick<Systeminformation.MemData, "total" | "available">,
  darwinVmStat: string | null,
): number {
  const darwinUsed = darwinVmStat ? darwinUsedMemoryBytes(darwinVmStat) : null;
  return darwinUsed ?? mem.total - mem.available;
}

// @vitest-environment node
import { describe, expect, it } from "vitest";
import { calculateUsedMemoryBytes } from "@/lib/system/memory-usage";

const MAC_TOTAL_BYTES = 103_079_215_104;

const MAC_VM_STAT = `Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                             1603950.
Pages active:                           1982592.
Pages inactive:                         1771353.
Pages speculative:                       270003.
Pages throttled:                              0.
Pages wired down:                        508456.
Pages purgeable:                         435502.
"Translation faults":               21840249800.
Pages copy-on-write:                 5313038297.
Pages zero filled:                   3890802239.
Pages reactivated:                      3904059.
Pages purged:                           7113256.
File-backed pages:                       904424.
Anonymous pages:                        3119524.
Pages stored in compressor:              244909.
Pages occupied by compressor:            109017.
Decompressions:                         5356893.
Compressions:                           6063409.
Pageins:                               87518920.
Pageouts:                                    70.
Swapins:                                      0.
Swapouts:                                     0.
`;

describe("calculateUsedMemoryBytes", () => {
  it("reports macOS memory like Activity Monitor, excluding cached files", () => {
    const used = calculateUsedMemoryBytes(
      { total: MAC_TOTAL_BYTES, available: 0 },
      MAC_VM_STAT,
    );

    // (anonymous - purgeable + wired + compressed) pages * 16 KiB
    expect(used).toBe(54_091_694_080);
    // `total - free` reported 70.2% for this snapshot.
    expect(Math.round((used / MAC_TOTAL_BYTES) * 1000) / 10).toBe(52.5);
  });

  it.each([
    ["no vm_stat output", null],
    ["unrecognised vm_stat output", "vm_stat: command failed"],
  ])("uses total minus available with %s", (_label, vmStat) => {
    expect(
      calculateUsedMemoryBytes({ total: 16_000, available: 12_000 }, vmStat),
    ).toBe(4_000);
  });
});

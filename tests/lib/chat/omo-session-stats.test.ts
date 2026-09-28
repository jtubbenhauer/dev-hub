import { describe, expect, it } from "vitest";
import {
  contextUsageLevel,
  formatContextPercent,
  formatCost,
  formatTokenCount,
} from "@/lib/chat/omo-session-stats";

describe("omo session stats formatting", () => {
  it("formats token counts compactly", () => {
    expect(formatTokenCount(840)).toBe("840");
    expect(formatTokenCount(118_400)).toBe("118k");
    expect(formatTokenCount(1_000_000)).toBe("1M");
    expect(formatTokenCount(1_250_000)).toBe("1.3M");
  });

  it("formats context percent without rounding small use to zero", () => {
    expect(formatContextPercent(0)).toBe("0%");
    expect(formatContextPercent(0.004)).toBe("<1%");
    expect(formatContextPercent(12.4)).toBe("12%");
  });

  it("formats cost", () => {
    expect(formatCost(0)).toBe("$0.00");
    expect(formatCost(0.004)).toBe("<$0.01");
    expect(formatCost(1.234)).toBe("$1.23");
  });

  it("escalates the usage level as the context fills", () => {
    expect(contextUsageLevel(40)).toBe("normal");
    expect(contextUsageLevel(70)).toBe("warning");
    expect(contextUsageLevel(90)).toBe("critical");
  });
});

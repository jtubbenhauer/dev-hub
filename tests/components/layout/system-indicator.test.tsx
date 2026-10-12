import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SystemSummary } from "@/types";

const hooks = vi.hoisted(() => ({
  useSystemSummary: vi.fn(),
  useSystemStatsSnapshot: vi.fn(),
}));
vi.mock("@/hooks/use-system-stats", () => hooks);
import { SystemIndicator } from "@/components/layout/system-indicator";

const summary: SystemSummary = {
  cpu: { usage: 42.4, cores: 8, model: "Apple M2", speed: 3.5 },
  memory: {
    total: 16_000_000_000,
    used: 10_080_000_000,
    free: 5_920_000_000,
    usagePercent: 63,
    swapTotal: 0,
    swapUsed: 0,
    swapPercent: 0,
  },
  uptime: 3_600,
  timestamp: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SystemIndicator", () => {
  it("renders CPU and memory from the 30 s summary hook", () => {
    hooks.useSystemSummary.mockReturnValue({ data: summary });

    render(<SystemIndicator />);

    expect(hooks.useSystemSummary).toHaveBeenCalledWith({ interval: 30_000 });
    expect(hooks.useSystemStatsSnapshot).not.toHaveBeenCalled();
    expect(screen.getByText("42%")).toBeInTheDocument();
    expect(screen.getByText("63%")).toBeInTheDocument();
  });

  it("renders nothing before the summary loads", () => {
    hooks.useSystemSummary.mockReturnValue({ data: undefined });

    const { container } = render(<SystemIndicator />);

    expect(container).toBeEmptyDOMElement();
  });
});

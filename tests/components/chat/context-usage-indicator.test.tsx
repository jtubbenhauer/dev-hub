import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { OmoSessionStats } from "@/lib/chat/omo-session-stats";

const statsState = vi.hoisted(() => ({
  value: null as OmoSessionStats | null,
}));
vi.mock("@/hooks/use-omo-session-stats", () => ({
  useOmoSessionStats: () => statsState.value,
}));

import { ContextUsageIndicator } from "@/components/chat/context-usage-indicator";

function stats(percent: number): OmoSessionStats {
  return {
    tokens: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, total: 2 },
    cost: 0.5,
    contextUsage: { tokens: 120_000, contextWindow: 1_000_000, percent },
  };
}

function renderIndicator() {
  return render(
    <TooltipProvider>
      <ContextUsageIndicator workspaceId="ws" sessionId="omo_s" />
    </TooltipProvider>,
  );
}

describe("ContextUsageIndicator", () => {
  it("renders nothing without stats", () => {
    statsState.value = null;
    const { container } = renderIndicator();
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the percent of context used", () => {
    statsState.value = stats(12);
    renderIndicator();
    const meter = screen.getByRole("meter", { name: "Context used" });
    expect(meter).toHaveAttribute("aria-valuenow", "12");
    expect(meter).toHaveTextContent("12%");
  });

  it("warns when the context is nearly full", () => {
    statsState.value = stats(93);
    renderIndicator();
    expect(screen.getByText("93%")).toHaveClass("text-red-500");
  });
});

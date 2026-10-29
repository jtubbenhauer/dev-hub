import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { WorkspaceAccessBadge } from "@/components/workspace/workspace-access-badge";

function renderBadge(providerMeta: Record<string, unknown> | null) {
  return render(
    <TooltipProvider>
      <WorkspaceAccessBadge providerMeta={providerMeta} />
    </TooltipProvider>,
  );
}

describe("WorkspaceAccessBadge", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-10-29T01:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders nothing for a workspace without cloud access", () => {
    const { container } = renderBadge({ providerId: "rig" });
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the profile for ungated access", () => {
    renderBadge({ providerId: "rig", access: { profile: "dev-ops" } });
    expect(screen.getByText("dev-ops")).toBeInTheDocument();
    expect(screen.queryByText(/left/)).not.toBeInTheDocument();
  });

  it("counts down gated access and refreshes every minute", async () => {
    renderBadge({
      providerId: "rig",
      access: {
        profile: "prod-data",
        expiresAt: "2026-10-29T03:30:00.000Z",
      },
    });
    expect(screen.getByText(/2h 30m left/)).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(screen.getByText(/2h 29m left/)).toBeInTheDocument();
  });

  it("marks expired access", () => {
    renderBadge({
      providerId: "rig",
      access: {
        profile: "prod-data",
        expiresAt: "2026-10-29T00:30:00.000Z",
      },
    });
    expect(screen.getByText(/expired/)).toBeInTheDocument();
  });
});

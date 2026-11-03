import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/layout/authenticated-layout", () => ({
  AuthenticatedLayout: ({ children }: { children: ReactNode }) => (
    <div data-testid="authenticated-layout">{children}</div>
  ),
}));
vi.mock("@/components/dashboard/system-stats", () => ({
  SystemStatsCards: () => <div data-testid="system-stats" />,
}));
vi.mock("@/components/dashboard/quick-actions", () => ({
  QuickActions: () => <div data-testid="quick-actions" />,
}));
vi.mock("@/components/dashboard/workspace-overview", () => ({
  WorkspaceOverview: () => <div data-testid="workspace-overview" />,
}));
vi.mock("@/components/dashboard/clickup-tasks", () => ({
  ClickUpTasks: () => <div data-testid="clickup-tasks" />,
}));
vi.mock("@/components/dashboard/process-list", () => ({
  ProcessList: () => <div data-testid="process-list" />,
}));

import DashboardPage from "@/app/dashboard/page";

describe("dashboard page", () => {
  it("renders the dashboard sections inside the authenticated layout", async () => {
    // When
    render(<DashboardPage />);

    // Then
    const layout = screen.getByTestId("authenticated-layout");
    expect(
      screen.getByRole("heading", { level: 1, name: "Dashboard" }),
    ).toBeInTheDocument();
    expect(await screen.findByTestId("system-stats")).toBeInTheDocument();
    for (const section of [
      "quick-actions",
      "workspace-overview",
      "clickup-tasks",
      "process-list",
    ]) {
      expect(layout).toContainElement(screen.getByTestId(section));
    }
  });
});

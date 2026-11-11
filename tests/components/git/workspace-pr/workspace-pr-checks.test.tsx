import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WorkspacePrChecks } from "@/components/git/workspace-pr/workspace-pr-checks";
import { makeCheck, makePullRequest } from "./workspace-pr-fixtures";

describe("WorkspacePrChecks", () => {
  it("says so when the latest commit has no checks", () => {
    render(<WorkspacePrChecks pullRequest={makePullRequest({ checks: [] })} />);

    expect(
      screen.getByText("No checks reported for the latest commit"),
    ).toBeInTheDocument();
  });

  it("summarizes non-zero counts and notes when GitHub capped the list", () => {
    const checks = [
      makeCheck({ id: "f1", state: "failure", statusLabel: "Failed" }),
      makeCheck({ id: "f2", state: "failure", statusLabel: "Failed" }),
      makeCheck({
        id: "p1",
        state: "pending",
        statusLabel: "In progress",
        completedAt: null,
      }),
      makeCheck({ id: "s1" }),
    ];
    render(
      <WorkspacePrChecks
        pullRequest={makePullRequest({ checks, checksTotalCount: 120 })}
      />,
    );

    expect(
      screen.getByText("2 failing, 1 pending, 1 passing"),
    ).toBeInTheDocument();
    expect(screen.getByText("(showing 4 of 120)")).toBeInTheDocument();
  });

  it("keeps failing and pending rows visible and hides the rest behind a toggle", async () => {
    const user = userEvent.setup();
    const checks = [
      ...Array.from({ length: 7 }, (_, index) =>
        makeCheck({ id: `f${index}`, name: `lint-${index}`, state: "failure" }),
      ),
      makeCheck({ id: "p1", name: "e2e", state: "pending", completedAt: null }),
      ...Array.from({ length: 3 }, (_, index) =>
        makeCheck({ id: `s${index}`, name: `unit-${index}` }),
      ),
    ];
    render(<WorkspacePrChecks pullRequest={makePullRequest({ checks })} />);

    expect(screen.getByText("lint-6")).toBeInTheDocument();
    expect(screen.getByText("e2e")).toBeInTheDocument();
    expect(screen.queryByText("unit-0")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Show 3 more" }));

    expect(screen.getByText("unit-2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show less" })).toBeVisible();
  });

  it("links a check row to its details with the duration or status", () => {
    const checks = [
      makeCheck({
        id: "build",
        name: "build",
        workflowName: "CI",
        url: "https://github.com/acme/widgets/actions/runs/1",
      }),
      makeCheck({
        id: "deploy",
        name: "deploy",
        state: "pending",
        statusLabel: "Queued",
        completedAt: null,
      }),
    ];
    render(<WorkspacePrChecks pullRequest={makePullRequest({ checks })} />);

    const buildLink = screen.getByRole("link", { name: /build/ });
    expect(buildLink).toHaveTextContent("CI · build");
    expect(buildLink).toHaveAttribute(
      "href",
      "https://github.com/acme/widgets/actions/runs/1",
    );
    expect(buildLink).toHaveAttribute("target", "_blank");
    expect(buildLink).toHaveTextContent("1m 5s");
    expect(screen.getByText("Queued")).toBeInTheDocument();
  });
});

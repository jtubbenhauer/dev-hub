import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { SessionBackgroundChip } from "@/components/chat/session-background-chip";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { SessionBackgroundStatus } from "@/lib/opencode/types";
import { useSessionBackgroundStore } from "@/stores/session-background-store";

const SESSION_ID = "omo-session-1";

const WAITING_GOAL_WITH_MONITORS: SessionBackgroundStatus = {
  goal: "Pursuing goal (5m)",
  goalWait: "goal continues in 4m 30s · 2 wake sources on duty",
  goalCheckIn: "4m 30s",
  goalWaitProgress: 0.25,
  monitors: "watching 2: e2e scope gate, e2e scheduling gate (5m)",
  monitorCount: 2,
};

function setSessionStatus(sessionId: string, status: SessionBackgroundStatus) {
  act(() => {
    useSessionBackgroundStore.setState({
      statusBySession: { [sessionId]: status },
    });
  });
}

function renderChip(sessionId: string | null = SESSION_ID) {
  return render(
    <TooltipProvider>
      <SessionBackgroundChip sessionId={sessionId} />
    </TooltipProvider>,
  );
}

function getChip() {
  return screen.getByRole("group", { name: /^Background work:/ });
}

beforeEach(() => {
  useSessionBackgroundStore.setState({ statusBySession: {} });
});

describe("SessionBackgroundChip", () => {
  it("renders nothing when the session has no background status", () => {
    setSessionStatus("another-session", WAITING_GOAL_WITH_MONITORS);

    const { container } = renderChip();

    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing without an active session", () => {
    setSessionStatus(SESSION_ID, WAITING_GOAL_WITH_MONITORS);

    const { container } = renderChip(null);

    expect(container).toBeEmptyDOMElement();
  });

  it("shows the goal with its next check-in and wait progress", () => {
    setSessionStatus(SESSION_ID, {
      goal: "Pursuing goal (5m)",
      goalWait: "goal continues in 4m 30s · 2 wake sources on duty",
      goalCheckIn: "4m 30s",
      goalWaitProgress: 0.25,
    });

    renderChip();

    expect(
      within(getChip()).getByText("Goal · check-in 4m 30s"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("session-background-wait-progress")).toHaveStyle({
      transform: "scaleX(0.25)",
    });
    expect(screen.queryByText(/watching/i)).not.toBeInTheDocument();
  });

  it("shows only the goal while no check-in is scheduled", () => {
    setSessionStatus(SESSION_ID, { goal: "Pursuing goal (5m)" });

    renderChip();

    expect(within(getChip()).getByText("Goal")).toBeInTheDocument();
    expect(
      screen.queryByTestId("session-background-wait-progress"),
    ).not.toBeInTheDocument();
  });

  it.each([
    ["Goal paused (/goal resume)", "paused", "Goal paused"],
    [
      "Goal stopped: no progress (send a message or /goal resume)",
      "stopped",
      "Goal stopped",
    ],
    ["Goal blocked: waiting on review", "blocked", "Goal blocked"],
    ["Fix the scope gate… · Goal achieved (12m)", "achieved", "Goal achieved"],
  ] as const)("names the goal state of %j", (goal, goalState, visibleLabel) => {
    setSessionStatus(SESSION_ID, { goal, goalState });

    renderChip();

    expect(within(getChip()).getByText(visibleLabel)).toBeInTheDocument();
  });

  it("shows the monitor count without a goal", () => {
    setSessionStatus(SESSION_ID, {
      monitors: "watching e2e scope gate (11 scenarios x5) (3m)",
      monitorCount: 1,
    });

    renderChip();

    const chip = getChip();
    expect(within(chip).getByText("1 watching")).toBeInTheDocument();
    expect(within(chip).getByText("1")).toBeInTheDocument();
    expect(within(chip).queryByText(/^Goal/)).not.toBeInTheDocument();
  });

  it("keeps its width and shows only icons and counts below md", () => {
    setSessionStatus(SESSION_ID, WAITING_GOAL_WITH_MONITORS);

    renderChip();

    const chip = getChip();
    expect(chip).toHaveClass("shrink-0");
    expect(within(chip).getByText("Goal · check-in 4m 30s")).toHaveClass(
      "hidden",
      "md:inline",
    );
    expect(within(chip).getByText("2 watching")).toHaveClass(
      "hidden",
      "md:inline",
    );
    expect(within(chip).getByText("2")).toHaveClass("md:hidden");
  });

  it("exposes the full goal, wait and monitor lines", async () => {
    setSessionStatus(SESSION_ID, WAITING_GOAL_WITH_MONITORS);
    renderChip();

    expect(getChip()).toHaveAccessibleName(
      "Background work: Pursuing goal (5m). " +
        "goal continues in 4m 30s · 2 wake sources on duty. " +
        "watching 2: e2e scope gate, e2e scheduling gate (5m)",
    );

    await userEvent.tab();

    expect(getChip()).toHaveFocus();
    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip).toHaveTextContent("Pursuing goal (5m)");
    expect(tooltip).toHaveTextContent(
      "goal continues in 4m 30s · 2 wake sources on duty",
    );
    expect(tooltip).toHaveTextContent(
      "watching 2: e2e scope gate, e2e scheduling gate (5m)",
    );
  });

  it("lists each watch in the tooltip once omo sends its monitor list", async () => {
    setSessionStatus(SESSION_ID, {
      monitors: "watching 2: e2e scope gate +1 more (5m)",
      monitorCount: 2,
      monitorEntries: [
        {
          id: "bash_1",
          description: "e2e scope gate",
          isPaused: false,
          startedAtMs: 1,
        },
        { id: "bash_2", description: "deploy", isPaused: true, startedAtMs: 2 },
      ],
    });
    renderChip();

    await userEvent.tab();

    const tooltip = await screen.findByRole("tooltip");
    const watches = within(tooltip).getAllByRole("listitem");
    expect(watches.map((watch) => watch.textContent)).toEqual([
      "e2e scope gate",
      "deploy (muted)",
    ]);
    expect(tooltip).not.toHaveTextContent("+1 more");
  });

  it("follows store updates for its session", () => {
    setSessionStatus(SESSION_ID, WAITING_GOAL_WITH_MONITORS);
    renderChip();
    expect(
      within(getChip()).getByText("Goal · check-in 4m 30s"),
    ).toBeInTheDocument();

    setSessionStatus(SESSION_ID, {
      ...WAITING_GOAL_WITH_MONITORS,
      goalWait: "goal continues in 4m 29s · 2 wake sources on duty",
      goalCheckIn: "4m 29s",
      goalWaitProgress: 0.26,
    });

    const chip = getChip();
    expect(
      within(chip).getByText("Goal · check-in 4m 29s"),
    ).toBeInTheDocument();
    expect(
      within(chip).queryByText("Goal · check-in 4m 30s"),
    ).not.toBeInTheDocument();
    expect(chip).toHaveAccessibleName(/goal continues in 4m 29s/);

    act(() => {
      useSessionBackgroundStore.setState({ statusBySession: {} });
    });

    expect(
      screen.queryByRole("group", { name: /^Background work:/ }),
    ).not.toBeInTheDocument();
  });
});

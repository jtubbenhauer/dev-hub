import { act, render, screen } from "@testing-library/react";
import { Profiler } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import { SessionBackgroundIndicator } from "@/components/chat/session-background-indicator";
import type { SessionBackgroundStatus } from "@/lib/opencode/types";
import { useSessionBackgroundStore } from "@/stores/session-background-store";

const SESSION_ID = "omo_background-indicator";

const LIVE_GOAL_WITH_MONITORS: SessionBackgroundStatus = {
  goal: "Pursuing goal (25m)",
  goalState: "active",
  goalWait: "goal continues in 4m 30s · 1 eval · 1 wake source on duty",
  goalCheckIn: "4m 30s",
  goalWaitProgress: 0.25,
  monitors: "watching 2: e2e scope gate, e2e scheduling gate (5m)",
  monitorCount: 2,
};

function setSessionStatus(status: SessionBackgroundStatus) {
  act(() => {
    useSessionBackgroundStore.setState({
      statusBySession: { [SESSION_ID]: status },
    });
  });
}

function renderIndicator() {
  return render(<SessionBackgroundIndicator sessionId={SESSION_ID} />);
}

beforeEach(() => {
  useSessionBackgroundStore.setState({ statusBySession: {} });
});

describe("SessionBackgroundIndicator", () => {
  it("renders nothing without a background status", () => {
    const { container } = renderIndicator();

    expect(container).toBeEmptyDOMElement();
  });

  it.each([
    [
      "an achieved goal",
      {
        goal: "Fix the scope gate… · Goal achieved (12m)",
        goalState: "achieved",
      },
    ],
    [
      "a paused goal",
      { goal: "Goal paused (/goal resume)", goalState: "paused" },
    ],
    [
      "a blocked goal",
      { goal: "Goal blocked: waiting on review", goalState: "blocked" },
    ],
  ] as const)(
    "renders nothing for %s with nothing running",
    (_case, status) => {
      setSessionStatus(status);

      const { container } = renderIndicator();

      expect(container).toBeEmptyDOMElement();
    },
  );

  it("shows the monitor count beside a pinging radio", () => {
    setSessionStatus(LIVE_GOAL_WITH_MONITORS);

    renderIndicator();

    const indicator = screen.getByTitle(
      "Goal in progress · 2 monitors watching",
    );
    expect(indicator).toHaveAttribute(
      "aria-label",
      "Goal in progress · 2 monitors watching",
    );
    expect(indicator).toHaveTextContent(/^2$/);
    expect(indicator.querySelector(".lucide-radio")).toBeInTheDocument();
    expect(indicator.querySelector(".animate-ping")).toHaveClass(
      "motion-reduce:animate-none",
    );
    expect(indicator.querySelector(".lucide-target")).not.toBeInTheDocument();
  });

  it("shows a pulsing target for a live goal without monitors", () => {
    setSessionStatus({ goal: "Pursuing goal (25m)", goalState: "active" });

    renderIndicator();

    const indicator = screen.getByTitle("Goal in progress");
    expect(indicator.textContent).toBe("");
    expect(indicator.querySelector(".lucide-target")).toHaveClass(
      "animate-pulse",
      "motion-reduce:animate-none",
    );
    expect(indicator.querySelector(".lucide-radio")).not.toBeInTheDocument();
  });

  it("labels a single monitor running without a goal", () => {
    setSessionStatus({
      monitors:
        "watching scheduling gate rerun after looser reason matching (3m)",
      monitorCount: 1,
    });

    renderIndicator();

    expect(screen.getByTitle("1 monitor watching")).toHaveTextContent(/^1$/);
  });

  it("labels a scheduled check-in without its countdown", () => {
    setSessionStatus({
      goalWait: "goal resumes in 3m",
      goalCheckIn: "3m",
      goalWaitProgress: 0.5,
    });

    renderIndicator();

    const indicator = screen.getByTitle("Goal · check-in scheduled");
    expect(indicator).toHaveAttribute(
      "aria-label",
      "Goal · check-in scheduled",
    );
    expect(indicator.querySelector(".lucide-target")).toHaveClass(
      "animate-pulse",
    );
  });

  it("does not re-render when only the countdown changes", () => {
    setSessionStatus(LIVE_GOAL_WITH_MONITORS);
    const commitPhases: string[] = [];
    const { container } = render(
      <Profiler
        id="session-background-indicator"
        onRender={(_id, phase) => {
          commitPhases.push(phase);
        }}
      >
        <SessionBackgroundIndicator sessionId={SESSION_ID} />
      </Profiler>,
    );
    const initialMarkup = container.innerHTML;

    setSessionStatus({
      ...LIVE_GOAL_WITH_MONITORS,
      goalWait: "goal continues in 4m 29s · 1 eval · 1 wake source on duty",
      goalCheckIn: "4m 29s",
      goalWaitProgress: 0.26,
    });

    expect(commitPhases).toEqual(["mount"]);
    expect(container.innerHTML).toBe(initialMarkup);

    setSessionStatus({
      ...LIVE_GOAL_WITH_MONITORS,
      monitors: "watching e2e scope gate (6m)",
      monitorCount: 1,
    });

    expect(commitPhases).toEqual(["mount", "update"]);
    expect(
      screen.getByTitle("Goal in progress · 1 monitor watching"),
    ).toHaveTextContent(/^1$/);
  });
});

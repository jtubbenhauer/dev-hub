import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SessionBackgroundBanner } from "@/components/chat/session-background-banner";
import { TooltipProvider } from "@/components/ui/tooltip";
import type {
  SessionBackgroundMonitor,
  SessionBackgroundStatus,
} from "@/lib/opencode/types";
import { useSessionBackgroundStore } from "@/stores/session-background-store";

const SESSION_ID = "omo_background-banner";
const ACHIEVED_GOAL = "Fix the scope gate… · Goal achieved (12m)";
const MONITORS_LINE = "watching 2: e2e scope gate, e2e scheduling gate (5m)";
const WAIT_LINE = "goal continues in 4m 30s · 1 eval · 1 wake source on duty";

const WAITING_GOAL: SessionBackgroundStatus = {
  goal: "Pursuing goal (25m)",
  goalState: "active",
  goalWait: WAIT_LINE,
  goalCheckIn: "4m 30s",
  goalWaitProgress: 0.25,
};

const TWO_MONITORS: SessionBackgroundStatus = {
  monitors: MONITORS_LINE,
  monitorCount: 2,
};

const NOW_MS = Date.UTC(2026, 9, 17, 12);
const MINUTE_MS = 60_000;

function watch(
  id: string,
  description: string,
  minutesAgo: number,
  details: Partial<SessionBackgroundMonitor> = {},
): SessionBackgroundMonitor {
  return {
    id,
    description,
    isPaused: false,
    startedAtMs: NOW_MS - minutesAgo * MINUTE_MS,
    ...details,
  };
}

const FOUR_WATCHES_LINE = "watching 4: round-7 shift r… +3 more (10h 21m)";
const FOUR_WATCHES: SessionBackgroundStatus = {
  monitors: FOUR_WATCHES_LINE,
  monitorCount: 4,
  monitorEntries: [
    watch("bash_1", "round-7 shift review", 621, {
      command: "tail -F round-7.log | grep --line-buffered shift",
      fireCount: 3,
      lastFiredAtMs: NOW_MS - 2 * MINUTE_MS,
    }),
    watch("bash_2", "CI checks", 45),
    watch("bash_3", "deploy watch", 1_505, { isPaused: true }),
    watch("bash_4", "origin/main moves", 0),
  ],
};

function mockWatchListWidth(width: number) {
  vi.spyOn(Element.prototype, "clientWidth", "get").mockReturnValue(width);
}

function setStatusBySession(
  statusBySession: Record<string, SessionBackgroundStatus>,
) {
  act(() => {
    useSessionBackgroundStore.setState({ statusBySession });
  });
}

function renderBanner() {
  return render(
    <TooltipProvider delayDuration={0}>
      <SessionBackgroundBanner sessionId={SESSION_ID} />
    </TooltipProvider>,
  );
}

function getBanner() {
  return screen.getByRole("region", { name: "Background work" });
}

function animatedElements(banner: HTMLElement) {
  return Array.from(banner.querySelectorAll(".animate-pulse, .animate-ping"));
}

beforeEach(() => {
  useSessionBackgroundStore.setState({ statusBySession: {} });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("SessionBackgroundBanner", () => {
  it("renders nothing when its session has no background status", () => {
    setStatusBySession({ "omo_other-chat": WAITING_GOAL });

    const { container } = renderBanner();

    expect(container).toBeEmptyDOMElement();
  });

  it("hides an achieved goal until something runs again", () => {
    setStatusBySession({
      [SESSION_ID]: { goal: ACHIEVED_GOAL, goalState: "achieved" },
    });
    const { container } = renderBanner();

    expect(container).toBeEmptyDOMElement();

    setStatusBySession({
      [SESSION_ID]: {
        goal: ACHIEVED_GOAL,
        goalState: "achieved",
        ...TWO_MONITORS,
      },
    });

    expect(within(getBanner()).getByText(ACHIEVED_GOAL)).toBeInTheDocument();
  });

  it("shows a live goal with its next check-in and wait progress", () => {
    setStatusBySession({ [SESSION_ID]: WAITING_GOAL });

    renderBanner();

    const banner = getBanner();
    expect(banner).not.toHaveAttribute("aria-live");
    expect(within(banner).getByText("Pursuing goal (25m)")).toBeInTheDocument();
    expect(within(banner).getByText("check-in 4m 30s")).toBeInTheDocument();
    expect(within(banner).queryByText(/wake source/)).not.toBeInTheDocument();
    const waitProgress = within(banner).getByRole("progressbar", {
      name: "Wait until check-in",
    });
    expect(waitProgress).toHaveAttribute("aria-valuenow", "25");
    expect(waitProgress.firstElementChild).toHaveStyle({
      transform: "scaleX(0.25)",
    });
    expect(banner.querySelector(".lucide-target")).toHaveClass("animate-pulse");
  });

  it("names the goal by its state when only a check-in is scheduled", () => {
    setStatusBySession({
      [SESSION_ID]: {
        goalWait: "goal resumes in 3m",
        goalCheckIn: "3m",
        goalWaitProgress: 0.5,
      },
    });

    renderBanner();

    const banner = getBanner();
    expect(within(banner).getByText("Goal")).toBeInTheDocument();
    expect(within(banner).getByText("check-in 3m")).toBeInTheDocument();
    expect(banner.querySelector(".lucide-target")).toHaveClass("animate-pulse");
  });

  it("shows the monitors line beside a pinging radio", () => {
    setStatusBySession({ [SESSION_ID]: TWO_MONITORS });

    renderBanner();

    const banner = getBanner();
    expect(within(banner).getByText(MONITORS_LINE)).toBeInTheDocument();
    expect(banner.querySelector(".lucide-radio")).toBeInTheDocument();
    expect(banner.querySelector(".animate-ping")).toBeInTheDocument();
    expect(banner.querySelector(".lucide-target")).not.toBeInTheDocument();
  });

  it.each([
    ["Goal paused (/goal resume)", "paused"],
    ["Goal stopped: no progress (send a message or /goal resume)", "stopped"],
    ["Goal blocked: waiting on review", "blocked"],
  ] as const)("shows %j without animation", (goal, goalState) => {
    setStatusBySession({ [SESSION_ID]: { goal, goalState } });

    renderBanner();

    const banner = getBanner();
    expect(within(banner).getByText(goal)).toBeInTheDocument();
    expect(animatedElements(banner)).toHaveLength(0);
  });

  it("stops every animation when the user prefers reduced motion", () => {
    setStatusBySession({ [SESSION_ID]: { ...WAITING_GOAL, ...TWO_MONITORS } });

    renderBanner();

    const banner = getBanner();
    const animated = animatedElements(banner);
    expect(animated).toHaveLength(2);
    for (const element of animated) {
      expect(element).toHaveClass("motion-reduce:animate-none");
    }
    expect(
      within(banner).getByRole("progressbar").firstElementChild,
    ).toHaveClass("motion-reduce:transition-none");
  });

  it("truncates long goal and monitor lines on one row", () => {
    const stoppedGoal =
      "Goal stopped: no progress (send a message or /goal resume)";
    setStatusBySession({
      [SESSION_ID]: {
        goal: stoppedGoal,
        goalState: "stopped",
        ...TWO_MONITORS,
      },
    });

    renderBanner();

    const banner = getBanner();
    expect(within(banner).getByText(stoppedGoal)).toHaveClass("truncate");
    expect(within(banner).getByText(MONITORS_LINE)).toHaveClass("truncate");
  });

  it("shows the full goal, wait and monitor lines on hover", async () => {
    setStatusBySession({ [SESSION_ID]: { ...WAITING_GOAL, ...TWO_MONITORS } });
    renderBanner();

    await userEvent.hover(within(getBanner()).getByText("Pursuing goal (25m)"));

    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip).toHaveTextContent("Pursuing goal (25m)");
    expect(tooltip).toHaveTextContent(WAIT_LINE);
    expect(tooltip).toHaveTextContent(MONITORS_LINE);
  });

  describe("with omo's monitor list", () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(NOW_MS);
    });

    it("shows each watch as its own chip instead of the summary line", () => {
      mockWatchListWidth(1_000);
      setStatusBySession({
        [SESSION_ID]: { ...WAITING_GOAL, ...FOUR_WATCHES },
      });

      renderBanner();

      const banner = getBanner();
      expect(
        within(banner).getByText("Pursuing goal (25m)"),
      ).toBeInTheDocument();
      expect(within(banner).getByText("4 watching")).toBeInTheDocument();
      expect(
        within(banner).queryByText(FOUR_WATCHES_LINE),
      ).not.toBeInTheDocument();
      const chips = within(
        within(banner).getByRole("list", { name: "Watches" }),
      ).getAllByRole("listitem");
      expect(chips.map((chip) => chip.textContent)).toEqual([
        "round-7 shift review10h 21m",
        "CI checks45m",
        "deploy watch1d 1h 5m",
        "origin/main moves<1m",
      ]);
      expect(within(chips[2]).getByLabelText("Muted")).toBeInTheDocument();
      expect(banner.querySelector(".animate-ping")).toBeInTheDocument();
    });

    it("folds the watches that do not fit into a +N more menu", async () => {
      mockWatchListWidth(500);
      setStatusBySession({ [SESSION_ID]: FOUR_WATCHES });
      const user = userEvent.setup();
      renderBanner();

      const banner = getBanner();
      expect(within(banner).getAllByRole("listitem")).toHaveLength(2);
      expect(
        within(banner).queryByText("deploy watch"),
      ).not.toBeInTheDocument();

      await user.click(within(banner).getByRole("button", { name: "+2 more" }));

      const menuItems = screen.getAllByRole("menuitem");
      expect(menuItems.map((item) => item.textContent)).toEqual([
        "deploy watch1d 1h 5m",
        "origin/main moves<1m",
      ]);
      expect(menuItems[0]).toHaveAttribute(
        "title",
        "deploy watch\nrunning 1d 1h 5m · muted",
      );
    });

    it("shows a watch's command and fire history on hover", async () => {
      mockWatchListWidth(1_000);
      setStatusBySession({ [SESSION_ID]: FOUR_WATCHES });
      renderBanner();

      await userEvent.hover(
        within(getBanner()).getByText("round-7 shift review"),
      );

      const tooltip = await screen.findByRole("tooltip");
      expect(tooltip).toHaveTextContent(
        "tail -F round-7.log | grep --line-buffered shift",
      );
      expect(tooltip).toHaveTextContent(
        "running 10h 21m · fired 3 times · last 2m ago",
      );
    });
  });

  it("follows store updates for its session", () => {
    setStatusBySession({ [SESSION_ID]: WAITING_GOAL });
    renderBanner();

    setStatusBySession({
      [SESSION_ID]: {
        ...WAITING_GOAL,
        goalWait: "goal continues in 4m 29s · 1 eval · 1 wake source on duty",
        goalCheckIn: "4m 29s",
        goalWaitProgress: 0.26,
      },
    });

    const banner = getBanner();
    expect(within(banner).getByText("check-in 4m 29s")).toBeInTheDocument();
    expect(
      within(banner).queryByText("check-in 4m 30s"),
    ).not.toBeInTheDocument();
    expect(within(banner).getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "26",
    );

    setStatusBySession({});

    expect(
      screen.queryByRole("region", { name: "Background work" }),
    ).not.toBeInTheDocument();
  });
});

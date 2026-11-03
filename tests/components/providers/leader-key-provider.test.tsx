import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import {
  LeaderKeyProvider,
  useLeaderKey,
} from "@/components/providers/leader-key-provider";
import { WhichKeyPanel } from "@/components/leader-key/which-key-panel";
import { useLeaderAction } from "@/hooks/use-leader-action";
import type { LeaderBindingsMap } from "@/types/leader-key";

const navigation = vi.hoisted(() => ({ pathname: "/" }));

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
}));

const nextTab = vi.fn();
const previousTab = vi.fn();
const closeTab = vi.fn();

const tabActions = [
  {
    action: {
      id: "workbench:next-tab",
      label: "Next tab",
      page: "workbench",
      isRepeatable: true,
    },
    handler: nextTab,
  },
  {
    action: {
      id: "workbench:prev-tab",
      label: "Previous tab",
      page: "workbench",
      isRepeatable: true,
    },
    handler: previousTab,
  },
  {
    action: {
      id: "workbench:close-tab",
      label: "Close tab",
      page: "workbench",
    },
    handler: closeTab,
  },
];

const bindings: LeaderBindingsMap = {
  "workbench:next-tab": "]",
  "workbench:prev-tab": "[",
  "workbench:close-tab": "q",
};

function TabActions() {
  useLeaderAction(tabActions);
  return null;
}

function renderProvider() {
  render(
    <LeaderKeyProvider bindings={bindings}>
      <TabActions />
      <WhichKeyPanel />
    </LeaderKeyProvider>,
  );
}

// Returns false when the provider swallowed the key.
function press(key: string, modifiers: { metaKey?: boolean } = {}) {
  return fireEvent.keyDown(window, { key, ...modifiers });
}

function pressLeader() {
  fireEvent.keyDown(window, { key: " ", ctrlKey: true });
}

function waitMs(milliseconds: number) {
  act(() => {
    vi.advanceTimersByTime(milliseconds);
  });
}

describe("LeaderKeyProvider repeat window", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires a repeatable action again without the leader", () => {
    renderProvider();
    pressLeader();
    press("]");

    press("]");

    expect(nextTab).toHaveBeenCalledTimes(2);
  });

  it("fires a repeatable sibling without the leader", () => {
    renderProvider();
    pressLeader();
    press("]");

    press("[");

    expect(previousTab).toHaveBeenCalledOnce();
  });

  it("lets the key through once the window has timed out", () => {
    renderProvider();
    pressLeader();
    press("]");
    waitMs(1000);

    const isDelivered = press("]");

    expect(isDelivered).toBe(true);
    expect(nextTab).toHaveBeenCalledOnce();
  });

  it("restarts the window on every repeat press", () => {
    renderProvider();
    pressLeader();
    press("]");
    waitMs(800);
    press("]");
    waitMs(800);

    press("]");

    expect(nextTab).toHaveBeenCalledTimes(3);
  });

  it("closes the window on any other key and lets that key through", () => {
    renderProvider();
    pressLeader();
    press("]");

    const isDelivered = press("a");
    press("]");

    expect(isDelivered).toBe(true);
    expect(nextTab).toHaveBeenCalledOnce();
  });

  it("lets a repeat key pressed with a command modifier through", () => {
    renderProvider();
    pressLeader();
    press("]");

    const isDelivered = press("]", { metaKey: true });

    expect(isDelivered).toBe(true);
    expect(nextTab).toHaveBeenCalledOnce();
  });

  it("does not open a window after a non-repeatable action", () => {
    renderProvider();
    pressLeader();
    press("q");

    const isDelivered = press("q");

    expect(isDelivered).toBe(true);
    expect(closeTab).toHaveBeenCalledOnce();
  });

  it("lists only the repeat keys in the which-key panel while the window is open", () => {
    renderProvider();
    pressLeader();

    press("]");

    expect(screen.getByText("Previous tab")).toBeInTheDocument();
    expect(screen.queryByText("Close tab")).not.toBeInTheDocument();
  });

  it("hides the which-key panel when the window times out", () => {
    renderProvider();
    pressLeader();
    press("]");
    expect(screen.getByText("Next tab")).toBeInTheDocument();

    waitMs(1000);

    expect(screen.queryByText("Next tab")).not.toBeInTheDocument();
  });
});

function ActivePageProbe() {
  const { activePage } = useLeaderKey();
  return <output aria-label="Active leader page">{activePage}</output>;
}

describe("LeaderKeyProvider active page", () => {
  afterEach(() => {
    navigation.pathname = "/";
  });

  it.each([
    { pathname: "/", page: "workbench" },
    { pathname: "/dashboard", page: "dashboard" },
    { pathname: "/git", page: "git" },
    { pathname: "/workspaces", page: "repos" },
    { pathname: "/chat", page: "unknown" },
    { pathname: "/files", page: "unknown" },
  ])("resolves $pathname to the $page page", ({ pathname, page }) => {
    // Given
    navigation.pathname = pathname;

    // When
    render(
      <LeaderKeyProvider bindings={bindings}>
        <ActivePageProbe />
      </LeaderKeyProvider>,
    );

    // Then
    expect(
      screen.getByRole("status", { name: "Active leader page" }),
    ).toHaveTextContent(page);
  });
});

const jumpToLastUserMessage = vi.fn();
const saveFile = vi.fn();

// What a focused chat tab and a focused file tab register on the workbench.
const focusedTabActions = [
  {
    action: {
      id: "chat:last-user-message",
      label: "Jump to last user message",
      page: "chat",
    },
    handler: jumpToLastUserMessage,
  },
  {
    action: { id: "files:save", label: "Save file", page: "files" },
    handler: saveFile,
  },
];

function FocusedTabActions() {
  useLeaderAction(focusedTabActions);
  return null;
}

describe("LeaderKeyProvider page-scoped actions on the workbench", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    navigation.pathname = "/";
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    { keys: ["]"], handler: nextTab },
    { keys: ["}"], handler: jumpToLastUserMessage },
    { keys: ["S"], handler: saveFile },
  ])("fires the action registered for leader $keys", ({ keys, handler }) => {
    // Given
    render(
      <LeaderKeyProvider
        bindings={{
          ...bindings,
          "chat:last-user-message": "}",
          "files:save": "S",
        }}
      >
        <TabActions />
        <FocusedTabActions />
      </LeaderKeyProvider>,
    );
    pressLeader();

    // When
    for (const key of keys) press(key);

    // Then
    expect(handler).toHaveBeenCalledOnce();
  });
});

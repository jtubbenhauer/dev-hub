import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { WhichKeyPanel } from "@/components/leader-key/which-key-panel";
import { LeaderKeyProvider } from "@/components/providers/leader-key-provider";
import { useWorkbenchLeaderActions } from "@/components/workbench/use-workbench-leader-actions";
import type { WorkbenchCommand } from "@/lib/workbench/workbench-controller-registry";
import { useContextSidebarStore } from "@/stores/context-sidebar-store";
import { useSessionSidebarStore } from "@/stores/session-sidebar-store";
import {
  mountFakeWorkbench,
  type FakeWorkbenchController,
} from "../../helpers/fake-workbench-controller";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

let workbench: {
  readonly controller: FakeWorkbenchController;
  readonly unmount: () => void;
};

function WorkbenchLeaderActionsProbe() {
  useWorkbenchLeaderActions();
  return null;
}

function renderWorkbenchLeader() {
  return render(
    <LeaderKeyProvider>
      <WorkbenchLeaderActionsProbe />
      <WhichKeyPanel />
    </LeaderKeyProvider>,
  );
}

function pressLeader() {
  fireEvent.keyDown(window, { key: " ", ctrlKey: true });
}

function pressKeys(keys: readonly string[]) {
  for (const key of keys) fireEvent.keyDown(window, { key });
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  useContextSidebarStore.setState(
    useContextSidebarStore.getInitialState(),
    true,
  );
  useSessionSidebarStore.setState(
    useSessionSidebarStore.getInitialState(),
    true,
  );
  workbench = mountFakeWorkbench("ws-1");
});

afterEach(() => {
  cleanup();
  workbench.unmount();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("useWorkbenchLeaderActions", () => {
  it.each<{ keys: readonly string[]; command: WorkbenchCommand }>([
    { keys: ["]"], command: { type: "cycle", direction: "next" } },
    { keys: ["["], command: { type: "cycle", direction: "previous" } },
    { keys: ["1"], command: { type: "focus-number", n: 1 } },
    { keys: ["2"], command: { type: "focus-number", n: 2 } },
    { keys: ["3"], command: { type: "focus-number", n: 3 } },
    { keys: ["4"], command: { type: "focus-number", n: 4 } },
    { keys: ["5"], command: { type: "focus-number", n: 5 } },
    { keys: ["6"], command: { type: "focus-number", n: 6 } },
    { keys: ["7"], command: { type: "focus-number", n: 7 } },
    { keys: ["8"], command: { type: "focus-number", n: 8 } },
    { keys: ["9"], command: { type: "focus-number", n: 9 } },
    { keys: ["q"], command: { type: "close-active" } },
    { keys: ["|"], command: { type: "split", direction: "right" } },
    { keys: ["-"], command: { type: "split", direction: "below" } },
    { keys: [">"], command: { type: "move-tab", direction: "right" } },
    { keys: ["<"], command: { type: "move-tab", direction: "left" } },
    { keys: ["H"], command: { type: "focus-group", direction: "left" } },
    { keys: ["L"], command: { type: "focus-group", direction: "right" } },
    { keys: ["K"], command: { type: "focus-group", direction: "up" } },
    { keys: ["J"], command: { type: "focus-group", direction: "down" } },
  ])("runs $command.type on leader $keys", ({ keys, command }) => {
    // Given
    renderWorkbenchLeader();
    pressLeader();

    // When
    pressKeys(keys);

    // Then
    expect(workbench.controller.runCommand).toHaveBeenCalledExactlyOnceWith(
      command,
    );
  });

  it("cycles again when ] is pressed a second time without the leader", () => {
    // Given
    renderWorkbenchLeader();
    pressLeader();
    pressKeys(["]"]);

    // When
    pressKeys(["]"]);

    // Then
    expect(workbench.controller.runCommand).toHaveBeenCalledTimes(2);
    expect(workbench.controller.runCommand).toHaveBeenLastCalledWith({
      type: "cycle",
      direction: "next",
    });
  });

  it("opens a new terminal tab on leader o t", () => {
    // Given
    renderWorkbenchLeader();
    pressLeader();

    // When
    pressKeys(["o", "t"]);

    // Then
    expect(workbench.controller.openNewTerminal).toHaveBeenCalledOnce();
    expect(workbench.controller.openNewChat).not.toHaveBeenCalled();
  });

  it("opens a new chat tab on leader o c", () => {
    // Given
    renderWorkbenchLeader();
    pressLeader();

    // When
    pressKeys(["o", "c"]);

    // Then
    expect(workbench.controller.openNewChat).toHaveBeenCalledOnce();
    expect(workbench.controller.openNewTerminal).not.toHaveBeenCalled();
  });

  it("hides the context sidebar on leader B", () => {
    // Given
    renderWorkbenchLeader();
    pressLeader();

    // When
    pressKeys(["B"]);

    // Then
    expect(useContextSidebarStore.getState().isOpen).toBe(false);
  });

  it("opens the panels sheet on leader B on a phone", () => {
    // Given
    vi.stubGlobal("innerWidth", 390);
    renderWorkbenchLeader();
    pressLeader();

    // When
    pressKeys(["B"]);

    // Then
    expect(useContextSidebarStore.getState()).toMatchObject({
      isOpen: true,
      isMobileSheetOpen: true,
    });
  });

  it("hides the session sidebar on leader s", () => {
    // Given
    renderWorkbenchLeader();
    pressLeader();

    // When
    pressKeys(["s"]);

    // Then
    expect(useSessionSidebarStore.getState().isOpen).toBe(false);
  });

  it("opens the session sheet on leader s on a phone", () => {
    // Given
    vi.stubGlobal("innerWidth", 390);
    renderWorkbenchLeader();
    pressLeader();

    // When
    pressKeys(["s"]);

    // Then
    expect(useSessionSidebarStore.getState()).toMatchObject({
      isOpen: true,
      isMobileSheetOpen: true,
    });
  });

  it("lists the workbench actions in the which-key panel", () => {
    // Given
    renderWorkbenchLeader();

    // When
    pressLeader();

    // Then
    expect(screen.getByText("Next tab")).toBeInTheDocument();
    expect(screen.getByText("Split right")).toBeInTheDocument();
    expect(screen.getByText("Toggle context sidebar")).toBeInTheDocument();
  });

  it("drops the workbench actions once the workbench unmounts", () => {
    // Given
    const view = renderWorkbenchLeader();
    view.rerender(
      <LeaderKeyProvider>
        <WhichKeyPanel />
      </LeaderKeyProvider>,
    );
    pressLeader();

    // When
    pressKeys(["]"]);

    // Then
    expect(workbench.controller.runCommand).not.toHaveBeenCalled();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CommandDrawer } from "@/components/command-runner/command-drawer";
import { useCommandStore } from "@/stores/command-store";

const FINISHED_SESSION = {
  sessionId: "session-1",
  command: "echo done",
  workspaceId: "ws-1",
  lines: ["done"],
  isRunning: false,
  exitCode: 0,
  abortController: null,
};

function renderDrawer() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <CommandDrawer />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({ processes: [] }), { status: 200 }),
    ),
  );
  useCommandStore.setState({
    isDrawerOpen: true,
    activeSessionId: null,
    sessions: { [FINISHED_SESSION.sessionId]: FINISHED_SESSION },
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  useCommandStore.setState({
    isDrawerOpen: false,
    activeSessionId: null,
    sessions: {},
  });
});

describe("CommandDrawer", () => {
  it("opens with the command input and session tabs", () => {
    // Given the drawer is open with one finished session
    renderDrawer();

    // Then the input and the session tab render without crashing
    expect(screen.getByPlaceholderText("Enter command…")).toBeInTheDocument();
    expect(screen.getByText("echo done")).toBeInTheDocument();
  });

  it("never nests the close button inside the tab button", () => {
    // Given the drawer shows a session tab
    renderDrawer();

    // Then the close button is a sibling, not a descendant, of the tab button
    const closeButton = screen.getByRole("button", { name: "Close echo done" });
    expect(closeButton.parentElement?.closest("button")).toBeNull();
  });

  it("selects a tab and closes it", async () => {
    // Given the drawer shows a session tab
    const user = userEvent.setup();
    renderDrawer();

    // When the user selects the tab, its output is shown
    await user.click(screen.getByText("echo done"));
    expect(useCommandStore.getState().activeSessionId).toBe("session-1");
    expect(screen.getByText("done")).toBeInTheDocument();

    // And when the user closes it, the session is removed
    await user.click(screen.getByRole("button", { name: "Close echo done" }));
    expect(useCommandStore.getState().sessions).toEqual({});
  });
});

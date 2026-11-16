import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useTerminalStore } from "@/stores/terminal-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { EMPTY_ACTIVITY_BASELINE } from "@/lib/terminal/terminal-activity";
import type { TerminalSessionInfo } from "@/lib/terminal/terminal-protocol";

vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));
vi.mock("@/lib/notifications", () => ({ sendBrowserNotification: vi.fn() }));

let serverSessions: TerminalSessionInfo[] = [];
const mockFetch = vi.fn(() =>
  Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ sessions: serverSessions }),
  }),
);
vi.stubGlobal("fetch", mockFetch);

import { toast } from "sonner";
import { TerminalActivityWatcher } from "@/components/terminal/terminal-activity-watcher";

function defaultSession(
  overrides: Partial<TerminalSessionInfo>,
): TerminalSessionInfo {
  return {
    workspaceId: "ws-1",
    sessionId: "default",
    kind: "shell",
    isPinned: false,
    isAttached: true,
    hasExited: false,
    exitCode: null,
    createdAt: 1,
    lastOutputAt: 100,
    runningCommand: null,
    lastFinishedCommand: null,
    idleExpiresAt: null,
    ...overrides,
  };
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

function renderWatcher() {
  return render(
    <QueryClientProvider client={queryClient}>
      <TerminalActivityWatcher />
    </QueryClientProvider>,
  );
}

let pollCount = 0;

async function pollWith(sessions: TerminalSessionInfo[]) {
  pollCount += 1;
  const markerKey = `ws-1:marker-${pollCount}`;
  serverSessions = [
    ...sessions,
    defaultSession({ sessionId: `marker-${pollCount}`, hasExited: true }),
  ];
  await act(() =>
    queryClient.refetchQueries({ queryKey: ["terminal-sessions"] }),
  );
  await waitFor(() =>
    expect(
      useTerminalStore.getState().activityBaseline.seenOutputAt[markerKey],
    ).toBeDefined(),
  );
}

function clickToastAction() {
  const action: unknown = vi.mocked(toast.success).mock.calls[0]?.[1]?.action;
  if (
    typeof action !== "object" ||
    action === null ||
    !("onClick" in action) ||
    typeof action.onClick !== "function"
  ) {
    throw new Error("Expected the toast to offer an action");
  }
  action.onClick();
}

async function waitForBaseline() {
  await waitFor(() =>
    expect(
      useTerminalStore.getState().activityBaseline.notifiedFinishAt[
        "ws-1:default"
      ],
    ).toBeDefined(),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  queryClient.clear();
  serverSessions = [defaultSession({})];
  useWorkspaceStore.setState({ workspaces: [], activeWorkspaceId: "ws-1" });
  useTerminalStore.setState({
    isOpen: true,
    tabsByWorkspace: {
      "ws-1": [{ sessionId: "default", title: "Terminal 1" }],
    },
    activeTabByWorkspace: { "ws-1": "default" },
    unseenActivityKeys: {},
    endedSessionKeys: {},
    pageWorkspaceId: null,
    activityBaseline: EMPTY_ACTIVITY_BASELINE,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("TerminalActivityWatcher", () => {
  it("does not flag output the user already watched after the header remounts", async () => {
    const first = renderWatcher();
    await waitFor(() =>
      expect(
        useTerminalStore.getState().activityBaseline.seenOutputAt[
          "ws-1:default"
        ],
      ).toBe(100),
    );

    const outputBeforeClose = Date.now() - 1;
    act(() => useTerminalStore.getState().setOpen(false));
    first.unmount();

    renderWatcher();
    await pollWith([defaultSession({ lastOutputAt: outputBeforeClose })]);
    expect(useTerminalStore.getState().unseenActivityKeys).toEqual({});
  });

  it("flags output that arrives after the drawer closed", async () => {
    const first = renderWatcher();
    await waitForBaseline();
    act(() => useTerminalStore.getState().setOpen(false));
    first.unmount();

    renderWatcher();
    await pollWith([defaultSession({ lastOutputAt: Date.now() + 60_000 })]);
    expect(useTerminalStore.getState().unseenActivityKeys).toEqual({
      "ws-1:default": true,
    });
  });

  it("announces a long command that finished while the drawer was closed", async () => {
    useTerminalStore.setState({ isOpen: false });
    renderWatcher();
    await waitForBaseline();

    await pollWith([
      defaultSession({
        lastFinishedCommand: {
          name: "make",
          durationMs: 90_000,
          finishedAt: Date.now(),
        },
      }),
    ]);
    expect(toast.success).toHaveBeenCalledWith(
      "make finished",
      expect.objectContaining({
        description: expect.stringContaining("took 1m 30s"),
      }),
    );
  });

  it("counts the terminal page's tab as seen while the drawer is closed", async () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    useTerminalStore.setState({ isOpen: false, pageWorkspaceId: "ws-1" });
    renderWatcher();
    await waitForBaseline();

    await pollWith([
      defaultSession({
        lastOutputAt: Date.now() + 60_000,
        lastFinishedCommand: {
          name: "make",
          durationMs: 90_000,
          finishedAt: Date.now(),
        },
      }),
    ]);
    expect(useTerminalStore.getState().unseenActivityKeys).toEqual({});
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("shows a finished command on the terminal page without opening the drawer", async () => {
    useTerminalStore.setState({
      isOpen: false,
      pageWorkspaceId: "ws-1",
      tabsByWorkspace: {
        "ws-1": [
          { sessionId: "default", title: "Terminal 1" },
          { sessionId: "term-2", title: "Terminal 2" },
        ],
      },
    });
    serverSessions = [
      defaultSession({}),
      defaultSession({ sessionId: "term-2" }),
    ];
    renderWatcher();
    await waitFor(() =>
      expect(
        useTerminalStore.getState().activityBaseline.notifiedFinishAt[
          "ws-1:term-2"
        ],
      ).toBeDefined(),
    );

    await pollWith([
      defaultSession({}),
      defaultSession({
        sessionId: "term-2",
        lastFinishedCommand: {
          name: "make",
          durationMs: 90_000,
          finishedAt: Date.now(),
        },
      }),
    ]);
    expect(toast.success).toHaveBeenCalledWith(
      "make finished",
      expect.objectContaining({
        action: expect.objectContaining({ label: "Show" }),
      }),
    );

    act(() => clickToastAction());
    expect(useTerminalStore.getState().activeTabByWorkspace["ws-1"]).toBe(
      "term-2",
    );
    expect(useTerminalStore.getState().isOpen).toBe(false);
  });
});

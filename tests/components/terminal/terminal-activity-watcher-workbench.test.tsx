import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import type { TerminalSessionInfo } from "@/lib/terminal/terminal-protocol";

vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));
vi.mock("@/lib/notifications", () => ({ sendBrowserNotification: vi.fn() }));

const serverSessions = vi.hoisted(() => ({
  current: [] as TerminalSessionInfo[],
}));
vi.mock("@/hooks/use-terminal-sessions", () => ({
  useTerminalSessions: () => ({ data: serverSessions.current }),
}));

import { toast } from "sonner";
import { TerminalActivityWatcher } from "@/components/terminal/terminal-activity-watcher";
import { sendBrowserNotification } from "@/lib/notifications";
import {
  EMPTY_ACTIVITY_BASELINE,
  FINISH_NOTIFY_MIN_DURATION_MS,
} from "@/lib/terminal/terminal-activity";
import { terminalSessionKey } from "@/lib/terminal/terminal-protocol";
import { useTerminalStore } from "@/stores/terminal-store";
import { useWorkspaceStore } from "@/stores/workspace-store";

const WORKSPACE_ID = "ws-1";
const WORKBENCH_SESSION_ID = "wb-term-1a2b3c4d";
const DRAWER_SESSION_ID = "term-11111111";
const LAST_OUTPUT_AT = 1_000;

function sessionInfo(
  overrides: Partial<TerminalSessionInfo>,
): TerminalSessionInfo {
  return {
    workspaceId: WORKSPACE_ID,
    sessionId: DRAWER_SESSION_ID,
    kind: "shell",
    isPinned: false,
    isAttached: false,
    hasExited: false,
    exitCode: null,
    createdAt: 1,
    lastOutputAt: LAST_OUTPUT_AT,
    runningCommand: null,
    lastFinishedCommand: null,
    idleExpiresAt: null,
    ...overrides,
  };
}

function drawerTabSessionIds(): string[] {
  const tabs = useTerminalStore.getState().tabsByWorkspace[WORKSPACE_ID] ?? [];
  return tabs.map((tab) => tab.sessionId);
}

// A baseline that already knows the session, so a newer finish is reported.
function seedKnownSession(sessionId: string, notifiedFinishAt: number) {
  const key = terminalSessionKey(WORKSPACE_ID, sessionId);
  useTerminalStore.setState({
    activityBaseline: {
      seenOutputAt: { [key]: LAST_OUTPUT_AT },
      notifiedFinishAt: { [key]: notifiedFinishAt },
    },
  });
}

function longCommandFinishedAt(finishedAt: number) {
  return {
    name: "make",
    durationMs: FINISH_NOTIFY_MIN_DURATION_MS + 60_000,
    finishedAt,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  serverSessions.current = [];
  useWorkspaceStore.setState({
    workspaces: [],
    activeWorkspaceId: WORKSPACE_ID,
  });
  useTerminalStore.setState({
    isOpen: false,
    tabsByWorkspace: {
      [WORKSPACE_ID]: [{ sessionId: "default", title: "Terminal 1" }],
    },
    activeTabByWorkspace: { [WORKSPACE_ID]: "default" },
    unseenActivityKeys: {},
    endedSessionKeys: {},
    activityBaseline: EMPTY_ACTIVITY_BASELINE,
  });
});

describe("TerminalActivityWatcher with workbench terminals", () => {
  it("adopts a running drawer session but never a workbench session", () => {
    // Given
    serverSessions.current = [
      sessionInfo({ sessionId: WORKBENCH_SESSION_ID }),
      sessionInfo({ sessionId: DRAWER_SESSION_ID }),
    ];

    // When
    render(<TerminalActivityWatcher />);

    // Then
    expect(drawerTabSessionIds()).toEqual(["default", DRAWER_SESSION_ID]);
  });

  it("does not announce a long command that finished in a workbench terminal", () => {
    // Given
    const finishedAt = Date.now();
    seedKnownSession(WORKBENCH_SESSION_ID, finishedAt - 120_000);
    serverSessions.current = [
      sessionInfo({
        sessionId: WORKBENCH_SESSION_ID,
        lastFinishedCommand: longCommandFinishedAt(finishedAt),
      }),
    ];

    // When
    render(<TerminalActivityWatcher />);

    // Then
    expect(toast.success).not.toHaveBeenCalled();
    expect(sendBrowserNotification).not.toHaveBeenCalled();
  });

  it("still announces a long command that finished in a drawer terminal", () => {
    // Given
    const finishedAt = Date.now();
    seedKnownSession(DRAWER_SESSION_ID, finishedAt - 120_000);
    serverSessions.current = [
      sessionInfo({
        sessionId: DRAWER_SESSION_ID,
        lastFinishedCommand: longCommandFinishedAt(finishedAt),
      }),
    ];

    // When
    render(<TerminalActivityWatcher />);

    // Then
    expect(toast.success).toHaveBeenCalledWith(
      "make finished",
      expect.anything(),
    );
    expect(sendBrowserNotification).toHaveBeenCalledOnce();
  });

  it("does not flag new workbench terminal output as unseen drawer activity", () => {
    // Given
    seedKnownSession(WORKBENCH_SESSION_ID, 0);
    serverSessions.current = [
      sessionInfo({
        sessionId: WORKBENCH_SESSION_ID,
        lastOutputAt: LAST_OUTPUT_AT + 500,
      }),
    ];

    // When
    render(<TerminalActivityWatcher />);

    // Then
    expect(useTerminalStore.getState().unseenActivityKeys).toEqual({});
  });
});

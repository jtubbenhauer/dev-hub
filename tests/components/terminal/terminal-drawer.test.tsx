import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useTerminalStore } from "@/stores/terminal-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { TerminalHandle } from "@/components/terminal/terminal-panel";
import type { TerminalSessionInfo } from "@/lib/terminal/terminal-protocol";
import type { Workspace } from "@/types";

interface CapturedPanelProps {
  autoFocus?: boolean;
  sessionId?: string;
  hasShellFeatures?: boolean;
  idleTimeoutMinutes?: number;
  onReady?: (handle: TerminalHandle) => void;
}

let capturedPanelProps: CapturedPanelProps | null = null;

vi.mock("@/components/terminal/terminal-panel", () => ({
  TerminalPanel: (props: CapturedPanelProps) => {
    capturedPanelProps = props;
    return <div data-testid="terminal-panel" data-session={props.sessionId} />;
  },
}));

vi.mock("@/hooks/use-settings", () => ({
  useTerminalScrollbackSetting: () => ({ scrollback: 5000, isLoading: false }),
  useTerminalFontSetting: () => ({
    terminalFont: "geist-mono" as const,
    isLoading: false,
  }),
  useTerminalIdleTimeoutSetting: () => ({
    idleTimeoutMinutes: 15,
    isLoading: false,
  }),
  terminalFontFamily: () => "var(--font-geist-mono), monospace",
}));

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  usePathname: () => "/workspaces",
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

let resolveResponse: { ok: boolean; body: unknown };
let serverSessions: TerminalSessionInfo[];
const mutationRequests: Array<{ url: string; method: string; body?: string }> =
  [];

vi.stubGlobal(
  "fetch",
  vi.fn((url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (url.startsWith("/api/terminal/resolve")) {
      return Promise.resolve({
        ok: resolveResponse.ok,
        json: () => Promise.resolve(resolveResponse.body),
      });
    }
    if (url === "/api/terminal/sessions") {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ sessions: serverSessions }),
      });
    }
    if (url.startsWith("/api/terminal/sessions/")) {
      mutationRequests.push({
        url,
        method,
        body: init?.body as string | undefined,
      });
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    }
    return Promise.reject(new Error(`Unexpected fetch ${url}`));
  }),
);

import { TerminalDrawer } from "@/components/terminal/terminal-drawer";

const TEST_WORKSPACE: Workspace = {
  id: "ws-1",
  userId: "user-1",
  name: "test-project",
  path: "/home/test/project",
  type: "repo",
  parentRepoPath: null,
  packageManager: null,
  quickCommands: null,
  backend: "local",
  provider: null,
  opencodeUrl: null,
  agentUrl: null,
  providerMeta: null,
  shellCommand: null,
  sshTarget: null,
  sshPath: null,
  worktreeSymlinks: null,
  linkedTaskId: null,
  linkedTaskMeta: null,
  color: null,
  createdAt: new Date(),
  lastAccessedAt: new Date(),
};

function sessionInfo(
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
    lastOutputAt: 1,
    runningCommand: null,
    lastFinishedCommand: null,
    idleExpiresAt: null,
    ...overrides,
  };
}

function renderDrawer() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <TerminalDrawer />
    </QueryClientProvider>,
  );
}

async function openDrawerWithPanel() {
  useTerminalStore.setState({ isOpen: true });
  renderDrawer();
  await waitFor(() => {
    expect(screen.getByTestId("terminal-panel")).toBeInTheDocument();
  });
}

describe("TerminalDrawer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    capturedPanelProps = null;
    mutationRequests.length = 0;
    serverSessions = [];
    resolveResponse = {
      ok: true,
      body: {
        wsUrl: "ws://localhost:3001",
        cwd: "/home/test",
        shellCommand: null,
      },
    };
    useTerminalStore.setState({
      isOpen: false,
      drawerHeightPx: null,
      isMaximized: false,
      tabsByWorkspace: {},
      activeTabByWorkspace: {},
      unseenActivityKeys: {},
      endedSessionKeys: {},
    });
    useWorkspaceStore.setState({
      workspaces: [TEST_WORKSPACE],
      activeWorkspaceId: "ws-1",
    });
  });

  it("does not pass autoFocus (defaults to true in TerminalPanel)", async () => {
    await openDrawerWithPanel();
    expect(capturedPanelProps?.autoFocus).toBeUndefined();
  });

  it("toggles open/closed with Ctrl+`", async () => {
    renderDrawer();
    expect(useTerminalStore.getState().isOpen).toBe(false);
    await userEvent.keyboard("{Control>}`{/Control}");
    expect(useTerminalStore.getState().isOpen).toBe(true);
    await userEvent.keyboard("{Control>}`{/Control}");
    expect(useTerminalStore.getState().isOpen).toBe(false);
  });

  it("shows 'select a workspace' when no workspace is active", () => {
    useWorkspaceStore.setState({ activeWorkspaceId: null });
    useTerminalStore.setState({ isOpen: true });
    renderDrawer();
    expect(screen.getByText(/select a workspace/i)).toBeInTheDocument();
  });

  it("shows error when resolve fails", async () => {
    resolveResponse = { ok: false, body: { error: "Connection refused" } };
    useTerminalStore.setState({ isOpen: true });
    renderDrawer();
    await waitFor(() => {
      expect(screen.getByText("Connection refused")).toBeInTheDocument();
    });
  });

  it("opens the legacy default session as the first tab with shell features", async () => {
    await openDrawerWithPanel();
    expect(screen.getByRole("tab", { name: "Terminal 1" })).toBeInTheDocument();
    expect(capturedPanelProps?.sessionId).toBe("default");
    expect(capturedPanelProps?.hasShellFeatures).toBe(true);
    expect(capturedPanelProps?.idleTimeoutMinutes).toBe(15);
  });

  it("adds a new tab and switches the panel to its session", async () => {
    await openDrawerWithPanel();
    fireEvent.click(screen.getByRole("button", { name: "New terminal" }));
    const secondTab = await screen.findByRole("tab", { name: "Terminal 2" });
    expect(secondTab).toHaveAttribute("aria-selected", "true");
    expect(capturedPanelProps?.sessionId).toMatch(/^term-/);
  });

  it("ends a session when its tab is closed", async () => {
    await openDrawerWithPanel();
    fireEvent.click(screen.getByRole("button", { name: "End Terminal 1" }));
    await waitFor(() =>
      expect(mutationRequests).toContainEqual(
        expect.objectContaining({
          url: "/api/terminal/sessions/ws-1/default",
          method: "DELETE",
        }),
      ),
    );
    await waitFor(() =>
      expect(capturedPanelProps?.sessionId).toMatch(/^term-/),
    );
  });

  it("pins the active session so it survives idle timeouts", async () => {
    serverSessions = [sessionInfo({ sessionId: "default" })];
    await openDrawerWithPanel();
    const pinButton = await screen.findByRole("button", { name: "Keep alive" });
    await waitFor(() => expect(pinButton).toBeEnabled());
    fireEvent.click(pinButton);
    await waitFor(() =>
      expect(mutationRequests).toContainEqual({
        url: "/api/terminal/sessions/ws-1/default",
        method: "PATCH",
        body: JSON.stringify({ isPinned: true }),
      }),
    );
  });

  it("adopts running server sessions that have no tab yet", async () => {
    serverSessions = [
      sessionInfo({ sessionId: "default" }),
      sessionInfo({ sessionId: "term-from-elsewhere", runningCommand: "node" }),
    ];
    await openDrawerWithPanel();
    expect(
      await screen.findByRole("tab", { name: /Terminal 2/ }),
    ).toHaveTextContent("· node");
  });

  it("sends the selected output to the chat input", async () => {
    await openDrawerWithPanel();
    capturedPanelProps?.onReady?.({
      write: vi.fn(),
      focus: vi.fn(),
      blur: vi.fn(),
      getSelection: () => "npm ERR! missing script",
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Send selection to chat" }),
    );
    expect(
      localStorage.getItem("devhub:pending-terminal-output:ws-1"),
    ).toContain("npm ERR! missing script");
    expect(mockPush).toHaveBeenCalledWith("/chat");
    expect(useTerminalStore.getState().isOpen).toBe(false);
  });

  it("toggles maximized from the toolbar", async () => {
    await openDrawerWithPanel();
    fireEvent.click(screen.getByRole("button", { name: "Maximize" }));
    expect(useTerminalStore.getState().isMaximized).toBe(true);
  });
});

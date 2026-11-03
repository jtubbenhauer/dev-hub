import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DockviewReact, type DockviewApi } from "dockview-react";

import type {
  TerminalHandle,
  TerminalPanel,
} from "@/components/terminal/terminal-panel";
import type { TerminalSessionInfo } from "@/lib/terminal/terminal-protocol";
import type { WorkbenchController } from "@/lib/workbench/workbench-controller-registry";
import type { WorkbenchLayoutApi } from "@/lib/workbench/workbench-layout-api";

type TerminalPanelProps = ComponentProps<typeof TerminalPanel>;

// Latest props of every mounted TerminalPanel, keyed by session id.
const terminalPanelProps = vi.hoisted(
  () => new Map<string, TerminalPanelProps>(),
);

vi.mock("@/components/terminal/terminal-panel", () => ({
  TerminalPanel: (props: TerminalPanelProps) => {
    terminalPanelProps.set(props.sessionId ?? "", props);
    return <div data-testid="terminal-panel" />;
  },
}));

interface ResolveReply {
  readonly status: number;
  readonly body: unknown;
}

// null keeps /api/terminal/resolve pending.
let resolveReply: ResolveReply | null;
let serverSessions: TerminalSessionInfo[];

vi.stubGlobal(
  "fetch",
  vi.fn((url: string) => {
    if (url.startsWith("/api/terminal/resolve")) {
      if (resolveReply === null) return new Promise<never>(() => {});
      return Promise.resolve(
        Response.json(resolveReply.body, { status: resolveReply.status }),
      );
    }
    if (url === "/api/terminal/sessions") {
      return Promise.resolve(Response.json({ sessions: serverSessions }));
    }
    return Promise.reject(new Error(`Unexpected fetch ${url}`));
  }),
);

import { WORKBENCH_PANEL_COMPONENTS } from "@/components/workbench/tab-registry";
import { createWorkbenchDockviewController } from "@/components/workbench/workbench-dockview-controller";
import { WorkbenchTabHeader } from "@/components/workbench/workbench-tab-header";
import { createActDockviewLayoutApi } from "./probe-dockview";

const WORKSPACE_ID = "w1";
const RESOLVED_CONFIG = {
  wsUrl: "ws://127.0.0.1:7623",
  cwd: "/tmp/qa/repo",
  shellCommand: "ssh devbox",
};
// Both differ from the defaults (5000, Geist Mono) so the settings must win.
const TERMINAL_SETTINGS = {
  "terminal-scrollback": 2000,
  "terminal-font": "jetbrains-mono-nerd",
};

interface TerminalWorkbench {
  readonly layoutApi: WorkbenchLayoutApi;
  readonly controller: WorkbenchController;
}

function renderTerminalWorkbench(): TerminalWorkbench {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
  queryClient.setQueryData(["settings"], TERMINAL_SETTINGS);
  const readyApis: DockviewApi[] = [];
  render(
    <QueryClientProvider client={queryClient}>
      <div style={{ width: 800, height: 600 }}>
        <DockviewReact
          components={WORKBENCH_PANEL_COMPONENTS}
          defaultTabComponent={WorkbenchTabHeader}
          defaultRenderer="always"
          onReady={(event) => readyApis.push(event.api)}
        />
      </div>
    </QueryClientProvider>,
  );
  const [api] = readyApis;
  if (!api) throw new Error("DockviewReact never fired onReady");
  const layoutApi = createActDockviewLayoutApi(api);
  const controller = createWorkbenchDockviewController({
    layoutApi,
    workspaceId: WORKSPACE_ID,
    endTerminalSession: vi.fn(),
    isMobile: false,
  });
  return { layoutApi, controller };
}

function terminalSessionIdOf(
  layoutApi: WorkbenchLayoutApi,
  panelId: string,
): string {
  const params = layoutApi.getPanel(panelId)?.params;
  if (params?.kind !== "terminal") {
    throw new Error(`${panelId} is not a terminal tab`);
  }
  return params.sessionId;
}

async function openTerminal(
  workbench: TerminalWorkbench,
): Promise<TerminalPanelProps> {
  const sessionId = terminalSessionIdOf(
    workbench.layoutApi,
    workbench.controller.openNewTerminal(),
  );
  return waitFor(() => {
    const props = terminalPanelProps.get(sessionId);
    if (!props) throw new Error(`no TerminalPanel for ${sessionId} yet`);
    return props;
  });
}

function addTerminalTab(
  layoutApi: WorkbenchLayoutApi,
  input: { readonly sessionId: string; readonly title: string },
) {
  layoutApi.addPanel({
    id: `tab-${input.sessionId}`,
    params: {
      kind: "terminal",
      workspaceId: WORKSPACE_ID,
      sessionId: input.sessionId,
      title: input.title,
    },
    title: input.title,
    groupId: null,
  });
}

function sessionInfo(
  overrides: Partial<TerminalSessionInfo>,
): TerminalSessionInfo {
  return {
    workspaceId: WORKSPACE_ID,
    sessionId: "wb-term-00000000",
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

function createTerminalHandle() {
  return {
    write: vi.fn(),
    focus: vi.fn(),
    blur: vi.fn(),
    getSelection: vi.fn(() => ""),
  } satisfies TerminalHandle;
}

beforeEach(() => {
  terminalPanelProps.clear();
  resolveReply = { status: 200, body: RESOLVED_CONFIG };
  serverSessions = [];
});

describe("TerminalTabPanel", () => {
  it("connects its own never-reaped workbench session", async () => {
    // Given
    const workbench = renderTerminalWorkbench();

    // When
    const props = await openTerminal(workbench);

    // Then
    expect(props.sessionId).toMatch(/^wb-term-[0-9a-f]{8}$/);
    expect(props.idleTimeoutMinutes).toBe(0);
    expect(props.hasShellFeatures).toBe(true);
    expect(props.workspaceId).toBe(WORKSPACE_ID);
  });

  it("connects with the resolved terminal config", async () => {
    // Given
    const workbench = renderTerminalWorkbench();

    // When
    const props = await openTerminal(workbench);

    // Then
    expect(props).toMatchObject(RESOLVED_CONFIG);
  });

  it("applies the terminal scrollback and font settings", async () => {
    // Given
    const workbench = renderTerminalWorkbench();

    // When
    const props = await openTerminal(workbench);

    // Then
    expect(props.scrollback).toBe(2000);
    expect(props.fontFamily).toBe("JetBrainsMonoNerdFontMono, monospace");
  });

  it("shows a spinner while the terminal config resolves", () => {
    // Given
    resolveReply = null;
    const { controller } = renderTerminalWorkbench();

    // When
    controller.openNewTerminal();

    // Then
    expect(
      screen.getByRole("status", { name: "Loading terminal" }),
    ).toBeInTheDocument();
  });

  it("shows the resolve error instead of a terminal", async () => {
    // Given
    resolveReply = { status: 500, body: { error: "PTY server unavailable" } };
    const { controller } = renderTerminalWorkbench();

    // When
    controller.openNewTerminal();

    // Then
    expect(
      await screen.findByText("PTY server unavailable"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("terminal-panel")).not.toBeInTheDocument();
  });

  it("auto-focuses only the terminal of the focused tab", async () => {
    // Given
    const workbench = renderTerminalWorkbench();
    const backgroundTerminal = await openTerminal(workbench);

    // When
    const focusedTerminal = await openTerminal(workbench);

    // Then
    expect(focusedTerminal.autoFocus).toBe(true);
    expect(terminalPanelProps.get(backgroundTerminal.sessionId ?? "")).toEqual(
      expect.objectContaining({ autoFocus: false }),
    );
  });

  it("focuses the terminal again when its tab is focused again", async () => {
    // Given
    const workbench = renderTerminalWorkbench();
    const firstPanelId = workbench.controller.openNewTerminal();
    const firstTerminal = await waitFor(() => {
      const props = terminalPanelProps.get(
        terminalSessionIdOf(workbench.layoutApi, firstPanelId),
      );
      if (!props) throw new Error("first TerminalPanel not mounted yet");
      return props;
    });
    const handle = createTerminalHandle();
    firstTerminal.onReady?.(handle);
    await openTerminal(workbench);

    // When
    workbench.layoutApi.activatePanel(firstPanelId);

    // Then
    expect(handle.focus).toHaveBeenCalledOnce();
  });
});

describe("terminal tab header", () => {
  it("shows a running-command spinner only on that terminal's tab", async () => {
    // Given
    serverSessions = [
      sessionInfo({ sessionId: "wb-term-1a2b3c4d", runningCommand: "make" }),
      sessionInfo({ sessionId: "wb-term-5e6f7a8b" }),
    ];
    const { layoutApi } = renderTerminalWorkbench();

    // When
    addTerminalTab(layoutApi, {
      sessionId: "wb-term-1a2b3c4d",
      title: "Terminal 1",
    });
    addTerminalTab(layoutApi, {
      sessionId: "wb-term-5e6f7a8b",
      title: "Terminal 2",
    });

    // Then
    const spinner = await screen.findByRole("img", { name: "Running make" });
    expect(within(screen.getByTitle("Terminal 1")).getByRole("img")).toBe(
      spinner,
    );
    expect(screen.getAllByRole("img", { name: /^Running / })).toHaveLength(1);
  });
});

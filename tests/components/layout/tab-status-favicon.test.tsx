import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  onTestFinished,
  vi,
} from "vitest";

import { TabStatusFavicon } from "@/components/layout/tab-status-favicon";
import {
  applyFaviconHref,
  isFaviconHrefApplied,
  loadFaviconBaseImage,
  renderFaviconFrame,
  restoreFaviconHref,
} from "@/lib/attention/favicon-canvas";
import type { PermissionRequest, SessionStatus } from "@/lib/opencode/types";
import { attentionKey, useAttentionStore } from "@/stores/attention-store";
import { useChatStore, type WorkspaceState } from "@/stores/chat-store";

const navigation = vi.hoisted(() => ({ pathname: "/chat" }));

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
}));

vi.mock("@/lib/attention/favicon-canvas", () => ({
  loadFaviconBaseImage: vi.fn(),
  renderFaviconFrame: vi.fn(),
  applyFaviconHref: vi.fn(),
  restoreFaviconHref: vi.fn(),
  isFaviconHrefApplied: vi.fn(),
}));

const WAITING_FRAME = "frame:#ef4444";
const WORKING_FRAME = "frame:#f59e0b";
const UNREAD_FRAME = "frame:#3b82f6";
const BASE_FRAME = "frame:base";
const BUSY_STATUS: SessionStatus = { type: "busy" };
const IDLE_STATUS: SessionStatus = { type: "idle" };

function makePermission(id: string): PermissionRequest {
  return {
    id,
    sessionID: "s-1",
    permission: "bash",
    patterns: [],
    metadata: {},
    always: [],
  };
}

function makeWorkspaceState(
  overrides: Partial<WorkspaceState> = {},
): WorkspaceState {
  return {
    sessions: {},
    sessionsLoaded: true,
    messages: {},
    optimisticMessageIds: {},
    sessionStatuses: {},
    permissions: [],
    questions: [],
    todos: {},
    todoUpdatedAt: {},
    sessionAgents: {},
    sessionModels: {},
    sessionVariants: {},
    lastViewedAt: {},
    pinnedSessionIds: new Set<string>(),
    sessionNotes: {},
    ...overrides,
  };
}

function seedConnectedWorkspace(overrides: Partial<WorkspaceState>) {
  useChatStore.setState({
    workspaceStates: { "ws-1": makeWorkspaceState(overrides) },
    sseWorkspaceIds: ["ws-1"],
  });
}

function stubSettingsResponse(settings: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json(settings)),
  );
}

function renderTabStatusFavicon() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function QueryWrapper({ children }: { readonly children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  }
  return {
    queryClient,
    ...render(<TabStatusFavicon />, { wrapper: QueryWrapper }),
  };
}

async function advanceTimers(milliseconds: number) {
  await act(() => vi.advanceTimersByTimeAsync(milliseconds));
}

async function flushPendingWork() {
  await advanceTimers(0);
}

function appendIconLink(): HTMLLinkElement {
  const iconLink = document.createElement("link");
  iconLink.setAttribute("rel", "icon");
  iconLink.setAttribute("href", "/favicon.ico");
  document.head.appendChild(iconLink);
  onTestFinished(() => iconLink.remove());
  return iconLink;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  navigation.pathname = "/chat";
  vi.mocked(loadFaviconBaseImage).mockResolvedValue(
    document.createElement("img"),
  );
  vi.mocked(renderFaviconFrame).mockImplementation(
    (_baseImage, dotColor) => `frame:${dotColor ?? "base"}`,
  );
  vi.mocked(isFaviconHrefApplied).mockReturnValue(true);
  stubSettingsResponse({});
  useChatStore.setState({
    workspaceStates: {},
    sseWorkspaceIds: [],
    optimisticStreamingSessionId: null,
  });
  useAttentionStore.setState({ unseenFinishedKeys: [] });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("TabStatusFavicon frames", () => {
  it("renders nothing", async () => {
    const { container } = renderTabStatusFavicon();
    await flushPendingWork();

    expect(container).toBeEmptyDOMElement();
  });

  it("applies the red waiting frame for a permission in a connected workspace", async () => {
    seedConnectedWorkspace({ permissions: [makePermission("perm-1")] });

    renderTabStatusFavicon();
    await flushPendingWork();

    expect(applyFaviconHref).toHaveBeenLastCalledWith(WAITING_FRAME);
  });

  it("blinks the amber working frame every second while a session is busy", async () => {
    seedConnectedWorkspace({ sessionStatuses: { "s-1": BUSY_STATUS } });
    renderTabStatusFavicon();
    await flushPendingWork();
    expect(applyFaviconHref).toHaveBeenLastCalledWith(WORKING_FRAME);

    await advanceTimers(1000);
    expect(applyFaviconHref).toHaveBeenLastCalledWith(BASE_FRAME);

    await advanceTimers(1000);
    expect(applyFaviconHref).toHaveBeenLastCalledWith(WORKING_FRAME);
  });

  it("applies the amber working frame while a prompt is optimistically streaming", async () => {
    useChatStore.setState({ optimisticStreamingSessionId: "s-1" });

    renderTabStatusFavicon();
    await flushPendingWork();

    expect(applyFaviconHref).toHaveBeenLastCalledWith(WORKING_FRAME);
  });

  it("shows a solid blue frame for an unseen finished session without blinking", async () => {
    useAttentionStore.setState({
      unseenFinishedKeys: [attentionKey("ws-1", "s-1")],
    });
    renderTabStatusFavicon();
    await flushPendingWork();
    expect(applyFaviconHref).toHaveBeenLastCalledWith(UNREAD_FRAME);
    vi.mocked(applyFaviconHref).mockClear();

    await advanceTimers(3000);

    expect(applyFaviconHref).not.toHaveBeenCalled();
  });

  it("re-applies the cached frame after a client-side navigation", async () => {
    seedConnectedWorkspace({ sessionStatuses: { "s-1": BUSY_STATUS } });
    const { rerender } = renderTabStatusFavicon();
    await flushPendingWork();
    vi.mocked(applyFaviconHref).mockClear();
    vi.mocked(renderFaviconFrame).mockClear();

    navigation.pathname = "/git";
    rerender(<TabStatusFavicon />);

    expect(applyFaviconHref).toHaveBeenCalledWith(WORKING_FRAME);
    expect(renderFaviconFrame).not.toHaveBeenCalled();
  });
});

describe("TabStatusFavicon restoring the original favicon", () => {
  it("restores the original favicon when every connected session is idle", async () => {
    seedConnectedWorkspace({ sessionStatuses: { "s-1": IDLE_STATUS } });

    renderTabStatusFavicon();
    await flushPendingWork();

    expect(restoreFaviconHref).toHaveBeenCalled();
    expect(applyFaviconHref).not.toHaveBeenCalled();
  });

  it("restores the original favicon and stops blinking when the busy session goes idle", async () => {
    seedConnectedWorkspace({ sessionStatuses: { "s-1": BUSY_STATUS } });
    renderTabStatusFavicon();
    await flushPendingWork();
    vi.mocked(applyFaviconHref).mockClear();
    vi.mocked(restoreFaviconHref).mockClear();

    act(() => {
      seedConnectedWorkspace({ sessionStatuses: { "s-1": IDLE_STATUS } });
    });
    await advanceTimers(3000);

    expect(restoreFaviconHref).toHaveBeenCalled();
    expect(applyFaviconHref).not.toHaveBeenCalled();
  });

  it("ignores busy sessions in workspaces without a live connection", async () => {
    useChatStore.setState({
      workspaceStates: {
        "ws-1": makeWorkspaceState(),
        "ws-sleeping": makeWorkspaceState({
          sessionStatuses: { "s-9": BUSY_STATUS },
        }),
      },
      sseWorkspaceIds: ["ws-1"],
    });

    renderTabStatusFavicon();
    await flushPendingWork();

    expect(restoreFaviconHref).toHaveBeenCalled();
    expect(applyFaviconHref).not.toHaveBeenCalled();
  });

  it("stops blinking and restores the original favicon on unmount", async () => {
    seedConnectedWorkspace({ sessionStatuses: { "s-1": BUSY_STATUS } });
    const { unmount } = renderTabStatusFavicon();
    await flushPendingWork();
    vi.mocked(applyFaviconHref).mockClear();
    vi.mocked(restoreFaviconHref).mockClear();

    unmount();
    await advanceTimers(3000);

    expect(restoreFaviconHref).toHaveBeenCalledOnce();
    expect(applyFaviconHref).not.toHaveBeenCalled();
  });

  it("keeps the original favicon when the base image cannot load", async () => {
    vi.mocked(loadFaviconBaseImage).mockResolvedValue(null);
    seedConnectedWorkspace({ permissions: [makePermission("perm-1")] });

    renderTabStatusFavicon();
    await flushPendingWork();

    expect(applyFaviconHref).not.toHaveBeenCalled();
  });

  it("keeps the original favicon when frames cannot be rendered", async () => {
    vi.mocked(renderFaviconFrame).mockReturnValue(null);
    seedConnectedWorkspace({ permissions: [makePermission("perm-1")] });

    renderTabStatusFavicon();
    await flushPendingWork();

    expect(restoreFaviconHref).toHaveBeenCalled();
    expect(applyFaviconHref).not.toHaveBeenCalled();
  });
});

describe("TabStatusFavicon settings gate", () => {
  it("never applies a dot when the tab status setting is off", async () => {
    stubSettingsResponse({ "notifications-favicon-enabled": false });
    seedConnectedWorkspace({ permissions: [makePermission("perm-1")] });

    const { queryClient } = renderTabStatusFavicon();
    await flushPendingWork();

    expect(queryClient.getQueryState(["settings"])?.status).toBe("success");
    expect(applyFaviconHref).not.toHaveBeenCalled();
    expect(restoreFaviconHref).toHaveBeenCalled();
  });

  it("applies no dot while the settings request is still pending", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => {})),
    );
    seedConnectedWorkspace({ permissions: [makePermission("perm-1")] });

    renderTabStatusFavicon();
    await advanceTimers(3000);

    expect(applyFaviconHref).not.toHaveBeenCalled();
  });
});

describe("TabStatusFavicon icon link observer", () => {
  it("re-applies the desired frame when the page rewrites the icon link", async () => {
    const iconLink = appendIconLink();
    seedConnectedWorkspace({ permissions: [makePermission("perm-1")] });
    renderTabStatusFavicon();
    await flushPendingWork();
    vi.mocked(applyFaviconHref).mockClear();
    vi.mocked(isFaviconHrefApplied).mockReturnValue(false);

    iconLink.setAttribute("href", "/favicon.ico?rerendered");
    await flushPendingWork();

    expect(applyFaviconHref).toHaveBeenCalledWith(WAITING_FRAME);
  });

  it("leaves the icon link alone while the desired frame is still applied", async () => {
    const iconLink = appendIconLink();
    seedConnectedWorkspace({ permissions: [makePermission("perm-1")] });
    renderTabStatusFavicon();
    await flushPendingWork();
    vi.mocked(applyFaviconHref).mockClear();

    iconLink.setAttribute("href", "/favicon.ico?rerendered");
    await flushPendingWork();

    expect(isFaviconHrefApplied).toHaveBeenCalledWith(WAITING_FRAME);
    expect(applyFaviconHref).not.toHaveBeenCalled();
  });

  it("leaves a rewritten icon link alone once the dot has been cleared", async () => {
    const iconLink = appendIconLink();
    seedConnectedWorkspace({ permissions: [makePermission("perm-1")] });
    renderTabStatusFavicon();
    await flushPendingWork();
    act(() => {
      seedConnectedWorkspace({ permissions: [] });
    });
    vi.mocked(applyFaviconHref).mockClear();
    vi.mocked(isFaviconHrefApplied).mockReturnValue(false);

    iconLink.setAttribute("href", "/favicon.ico?rerendered");
    await flushPendingWork();

    expect(applyFaviconHref).not.toHaveBeenCalled();
  });

  it("leaves a rewritten icon link alone once a new frame fails to render", async () => {
    const iconLink = appendIconLink();
    vi.mocked(renderFaviconFrame).mockImplementation((_baseImage, dotColor) =>
      dotColor === "#f59e0b" ? null : `frame:${dotColor ?? "base"}`,
    );
    seedConnectedWorkspace({ permissions: [makePermission("perm-1")] });
    renderTabStatusFavicon();
    await flushPendingWork();
    act(() => {
      seedConnectedWorkspace({ sessionStatuses: { "s-1": BUSY_STATUS } });
    });
    vi.mocked(applyFaviconHref).mockClear();
    vi.mocked(isFaviconHrefApplied).mockReturnValue(false);

    iconLink.setAttribute("href", "/favicon.ico?rerendered");
    await flushPendingWork();

    expect(applyFaviconHref).not.toHaveBeenCalled();
  });
});

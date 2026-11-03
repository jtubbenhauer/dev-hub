import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceChatEffectsHost } from "@/components/chat/workspace-chat-effects-host";
import { useChatStore } from "@/stores/chat-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { Workspace } from "@/types";

vi.mock("@/hooks/use-workspace-engine", () => ({
  useWorkspaceEngine: () => ({ engine: "opencode", isLoading: false }),
}));

const initialChatState = useChatStore.getState();
const initialWorkspaceState = useWorkspaceStore.getState();

function makeWorkspace(id: string, backend: Workspace["backend"]): Workspace {
  return {
    id,
    userId: "user-1",
    name: id,
    path: `/workspaces/${id}`,
    type: "repo",
    parentRepoPath: null,
    packageManager: null,
    quickCommands: null,
    backend,
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
    createdAt: new Date(0),
    lastAccessedAt: new Date(0),
  };
}

function renderHost() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <WorkspaceChatEffectsHost />
    </QueryClientProvider>,
  );
}

function stubStoreLoaders() {
  const store = useChatStore.getState();
  const setActiveWorkspaceId = vi
    .spyOn(store, "setActiveWorkspaceId")
    .mockImplementation(() => {});
  vi.spyOn(store, "fetchSessions").mockResolvedValue();
  vi.spyOn(store, "fetchCommands").mockResolvedValue();
  vi.spyOn(store, "fetchPinnedSessions").mockResolvedValue();
  vi.spyOn(store, "fetchSessionNotes").mockResolvedValue();
  return { setActiveWorkspaceId };
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ status: "ok" }))),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  useChatStore.setState(initialChatState, true);
  useWorkspaceStore.setState(initialWorkspaceState, true);
});

describe("WorkspaceChatEffectsHost", () => {
  it("renders nothing and syncs the active workspace into the chat store", () => {
    const { setActiveWorkspaceId } = stubStoreLoaders();
    useWorkspaceStore.setState({
      workspaces: [makeWorkspace("ws-a", "local")],
      activeWorkspaceId: "ws-a",
    });

    const { container } = renderHost();

    expect(container).toBeEmptyDOMElement();
    expect(setActiveWorkspaceId).toHaveBeenCalledWith("ws-a");
  });

  it("flushes queued messages once the active remote workspace is healthy", async () => {
    stubStoreLoaders();
    const store = useChatStore.getState();
    vi.spyOn(store, "hasQueuedMessages").mockReturnValue(true);
    const flushQueuedMessages = vi
      .spyOn(store, "flushQueuedMessages")
      .mockResolvedValue();
    useWorkspaceStore.setState({
      workspaces: [makeWorkspace("ws-remote", "remote")],
      activeWorkspaceId: "ws-remote",
    });

    renderHost();

    await waitFor(() =>
      expect(flushQueuedMessages).toHaveBeenCalledWith("ws-remote"),
    );
    expect(fetch).toHaveBeenCalledWith("/api/workspaces/ws-remote/health");
  });
});

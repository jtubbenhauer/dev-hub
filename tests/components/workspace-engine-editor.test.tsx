import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import { WorkspaceEngineEditor } from "@/components/workspace/workspace-engine-editor";
import { useChatStore } from "@/stores/chat-store";
import type { Workspace } from "@/types";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

HTMLElement.prototype.scrollIntoView = vi.fn();
HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
HTMLElement.prototype.releasePointerCapture = vi.fn();

class MockPointerEvent extends Event {
  button: number;
  ctrlKey: boolean;
  pointerType: string;

  constructor(type: string, props: PointerEventInit) {
    super(type, props);
    this.button = props.button || 0;
    this.ctrlKey = props.ctrlKey || false;
    this.pointerType = props.pointerType || "mouse";
  }
}
window.PointerEvent = MockPointerEvent as unknown as typeof PointerEvent;

type WorkspaceRow = Workspace & { engine?: string | null };

function workspaceRow(engine: string | null): WorkspaceRow {
  return {
    id: "ws-1",
    userId: "user-1",
    name: "Workspace",
    path: "/tmp/ws-1",
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
    createdAt: new Date(0),
    lastAccessedAt: new Date(0),
    engine,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const server = { defaultEngine: "opencode", putStatus: 200 };

const fetchMock = vi.fn(
  async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url === "/api/settings" && method === "GET") {
      return jsonResponse({ "chat-engine": server.defaultEngine });
    }
    if (url === "/api/workspaces/ws-1" && method === "PUT") {
      if (server.putStatus !== 200) {
        return jsonResponse({ error: "engine rejected" }, server.putStatus);
      }
      const body = JSON.parse(String(init?.body)) as { engine: string | null };
      return jsonResponse(workspaceRow(body.engine));
    }
    if (url.startsWith("/api/sessions/cache?") && method === "DELETE") {
      return jsonResponse({ deleted: true });
    }
    return jsonResponse({ error: "unexpected request" }, 404);
  },
);

function callsWithMethod(method: string) {
  return fetchMock.mock.calls
    .map((call) => ({ url: String(call[0]), init: call[1] }))
    .filter((call) => (call.init?.method ?? "GET") === method);
}

function renderEditor(workspace: WorkspaceRow) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  queryClient.setQueryData<Workspace[]>(["workspaces"], [workspace]);
  render(
    <QueryClientProvider client={queryClient}>
      <WorkspaceEngineEditor workspace={workspace} />
    </QueryClientProvider>,
  );
  return queryClient;
}

async function chooseEngine(optionName: string) {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Chat engine" }));
  const trigger = await screen.findByRole("combobox", { name: "Engine" });
  await waitFor(() => expect(trigger).toBeEnabled());
  await user.click(trigger);
  await user.click(await screen.findByRole("option", { name: optionName }));
}

const originalResetWorkspace = useChatStore.getState().resetWorkspace;
const resetWorkspace = vi.fn();

beforeEach(() => {
  server.defaultEngine = "opencode";
  server.putStatus = 200;
  fetchMock.mockClear();
  resetWorkspace.mockClear();
  vi.mocked(toast.error).mockClear();
  vi.stubGlobal("fetch", fetchMock);
  useChatStore.setState({ resetWorkspace });
});

afterEach(() => {
  useChatStore.setState({ resetWorkspace: originalResetWorkspace });
  vi.unstubAllGlobals();
});

describe("WorkspaceEngineEditor", () => {
  it("saves an omo override, then purges and resets the workspace", async () => {
    const queryClient = renderEditor(workspaceRow(null));

    expect(screen.queryByRole("combobox", { name: "Engine" })).toBeNull();
    await chooseEngine("OmO Native (omo)");

    await waitFor(() => expect(resetWorkspace).toHaveBeenCalledWith("ws-1"));
    const [workspacePut] = callsWithMethod("PUT");
    expect(workspacePut.url).toBe("/api/workspaces/ws-1");
    expect(JSON.parse(String(workspacePut.init?.body))).toEqual({
      engine: "omo",
    });
    expect(callsWithMethod("DELETE").map((call) => call.url)).toEqual([
      "/api/sessions/cache?workspaceId=ws-1",
    ]);
    expect(
      queryClient.getQueryData<WorkspaceRow[]>(["workspaces"])?.[0]?.engine,
    ).toBe("omo");
  });

  it("offers the inherited default and skips the reset when the effective engine is unchanged", async () => {
    server.defaultEngine = "omo";
    renderEditor(workspaceRow("omo"));

    await chooseEngine("Inherit default (OmO Native (omo))");

    await waitFor(() => expect(callsWithMethod("PUT")).toHaveLength(1));
    expect(JSON.parse(String(callsWithMethod("PUT")[0].init?.body))).toEqual({
      engine: null,
    });
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: "Engine" })).toBeEnabled(),
    );
    expect(callsWithMethod("DELETE")).toHaveLength(0);
    expect(resetWorkspace).not.toHaveBeenCalled();
  });

  it("reports a rejected update without resetting the workspace", async () => {
    server.putStatus = 400;
    renderEditor(workspaceRow(null));

    await chooseEngine("OmO Native (omo)");

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("engine rejected"),
    );
    expect(callsWithMethod("DELETE")).toHaveLength(0);
    expect(resetWorkspace).not.toHaveBeenCalled();
  });
});

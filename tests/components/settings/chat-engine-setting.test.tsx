import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ChatEngineSettingsCard } from "@/components/settings/chat-engine-settings";
import { useChatStore } from "@/stores/chat-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
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

function workspaceRow(id: string, engine?: string | null): WorkspaceRow {
  const row: WorkspaceRow = {
    id,
    userId: "user-1",
    name: id,
    path: `/tmp/${id}`,
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
  };
  if (engine !== undefined) row.engine = engine;
  return row;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const server = { chatEngine: "opencode" as unknown, putStatus: 200 };

const fetchMock = vi.fn(
  async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url === "/api/settings" && method === "GET") {
      return jsonResponse({ "chat-engine": server.chatEngine });
    }
    if (url === "/api/settings" && method === "PUT") {
      if (server.putStatus !== 200) {
        return jsonResponse({ error: "Failed to save setting" }, 500);
      }
      const body = JSON.parse(String(init?.body)) as { value: unknown };
      server.chatEngine = body.value;
      return jsonResponse(body);
    }
    if (url.startsWith("/api/sessions/cache?") && method === "DELETE") {
      return jsonResponse({ deleted: true });
    }
    return jsonResponse({ error: "unexpected request" }, 404);
  },
);

function callsWithMethod(method: string) {
  return fetchMock.mock.calls
    .map((call, index) => ({
      url: String(call[0]),
      init: call[1],
      order: fetchMock.mock.invocationCallOrder[index],
    }))
    .filter((call) => (call.init?.method ?? "GET") === method);
}

function renderCard() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ChatEngineSettingsCard />
    </QueryClientProvider>,
  );
}

async function openEngineSelect() {
  const trigger = await screen.findByRole("combobox", { name: "Chat engine" });
  await waitFor(() => expect(trigger).toBeEnabled());
  return trigger;
}

const originalResetWorkspace = useChatStore.getState().resetWorkspace;
const resetWorkspace = vi.fn();

beforeEach(() => {
  server.chatEngine = "opencode";
  server.putStatus = 200;
  fetchMock.mockClear();
  resetWorkspace.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  useChatStore.setState({ resetWorkspace });
  useWorkspaceStore.setState({
    workspaces: [
      workspaceRow("ws-inherit", null),
      workspaceRow("ws-omo", "omo"),
      workspaceRow("ws-opencode", "opencode"),
      workspaceRow("ws-legacy"),
    ],
  });
});

afterEach(() => {
  useChatStore.setState({ resetWorkspace: originalResetWorkspace });
  useWorkspaceStore.setState({ workspaces: [] });
  vi.unstubAllGlobals();
});

describe("ChatEngineSettingsCard", () => {
  it("saves the new default, then purges and resets every inheriting workspace", async () => {
    const user = userEvent.setup();
    renderCard();

    const trigger = await openEngineSelect();
    expect(trigger).toHaveTextContent("OpenCode");
    await user.click(trigger);
    await user.click(
      await screen.findByRole("option", { name: "OmO Native (omo)" }),
    );

    await waitFor(() => expect(resetWorkspace).toHaveBeenCalledTimes(2));
    expect(resetWorkspace.mock.calls.map(([id]) => id)).toEqual([
      "ws-inherit",
      "ws-legacy",
    ]);

    const [settingsPut] = callsWithMethod("PUT");
    expect(settingsPut.url).toBe("/api/settings");
    expect(JSON.parse(String(settingsPut.init?.body))).toEqual({
      key: "chat-engine",
      value: "omo",
    });

    const purges = callsWithMethod("DELETE");
    expect(purges.map((call) => call.url)).toEqual([
      "/api/sessions/cache?workspaceId=ws-inherit",
      "/api/sessions/cache?workspaceId=ws-legacy",
    ]);
    const firstResetOrder = resetWorkspace.mock.invocationCallOrder[0];
    for (const purge of purges) {
      expect(settingsPut.order).toBeLessThan(purge.order);
      expect(purge.order).toBeLessThan(firstResetOrder);
    }
    await waitFor(() =>
      expect(
        screen.getByRole("combobox", { name: "Chat engine" }),
      ).toHaveTextContent("OmO Native (omo)"),
    );
  });

  it("does not purge or reset anything when saving the setting fails", async () => {
    server.putStatus = 500;
    const user = userEvent.setup();
    renderCard();

    await user.click(await openEngineSelect());
    await user.click(
      await screen.findByRole("option", { name: "OmO Native (omo)" }),
    );

    await waitFor(() => expect(callsWithMethod("PUT")).toHaveLength(1));
    await waitFor(() =>
      expect(
        screen.getByRole("combobox", { name: "Chat engine" }),
      ).toBeEnabled(),
    );
    expect(callsWithMethod("DELETE")).toHaveLength(0);
    expect(resetWorkspace).not.toHaveBeenCalled();
  });

  it("shows the stored default engine", async () => {
    server.chatEngine = "omo";
    renderCard();

    const trigger = await openEngineSelect();

    await waitFor(() => expect(trigger).toHaveTextContent("OmO Native (omo)"));
  });
});

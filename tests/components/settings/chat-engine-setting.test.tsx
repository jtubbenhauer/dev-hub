import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChatEngineSettingsCard } from "@/components/settings/chat-engine-settings";
import { useChatStore } from "@/stores/chat-store";

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

const ENGINE_SELECT_NAME = "Default engine for new chats";

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
    return jsonResponse({ error: "unexpected request" }, 404);
  },
);

function callsWithMethod(method: string) {
  return fetchMock.mock.calls
    .map((call) => ({ url: String(call[0]), init: call[1] }))
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

async function findEngineSelect() {
  const trigger = await screen.findByRole("combobox", {
    name: ENGINE_SELECT_NAME,
  });
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
  vi.mocked(toast.success).mockClear();
  vi.stubGlobal("fetch", fetchMock);
  useChatStore.setState({ resetWorkspace });
});

afterEach(() => {
  useChatStore.setState({ resetWorkspace: originalResetWorkspace });
  vi.unstubAllGlobals();
});

describe("ChatEngineSettingsCard", () => {
  it("saves the default for new chats without clearing existing chats", async () => {
    const user = userEvent.setup();
    renderCard();

    const trigger = await findEngineSelect();
    expect(trigger).toHaveTextContent("OpenCode");
    await user.click(trigger);
    await user.click(
      await screen.findByRole("option", { name: "OmO Native (omo)" }),
    );

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        "New chats default to OmO Native (omo)",
      ),
    );
    const [settingsPut] = callsWithMethod("PUT");
    expect(settingsPut.url).toBe("/api/settings");
    expect(JSON.parse(String(settingsPut.init?.body))).toEqual({
      key: "chat-engine",
      value: "omo",
    });
    expect(callsWithMethod("DELETE")).toHaveLength(0);
    expect(resetWorkspace).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(
        screen.getByRole("combobox", { name: ENGINE_SELECT_NAME }),
      ).toHaveTextContent("OmO Native (omo)"),
    );
  });

  it("keeps the current default when saving fails", async () => {
    server.putStatus = 500;
    const user = userEvent.setup();
    renderCard();

    await user.click(await findEngineSelect());
    await user.click(
      await screen.findByRole("option", { name: "OmO Native (omo)" }),
    );

    await waitFor(() => expect(callsWithMethod("PUT")).toHaveLength(1));
    expect(await findEngineSelect()).toHaveTextContent("OpenCode");
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("shows the stored default engine", async () => {
    server.chatEngine = "omo";
    renderCard();

    const trigger = await findEngineSelect();

    await waitFor(() => expect(trigger).toHaveTextContent("OmO Native (omo)"));
  });
});

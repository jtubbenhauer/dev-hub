import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import { GeneralSettings } from "@/components/settings/general-settings";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

let storedSettings: Record<string, unknown> = {};

const fetchMock = vi.fn(
  async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const body = url.startsWith("/api/settings")
      ? init?.method === "PUT"
        ? { ok: true }
        : storedSettings
      : [];
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  },
);

function renderSettings() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <GeneralSettings />
    </QueryClientProvider>,
  );
}

async function findEnabledSwitch(name: string): Promise<HTMLElement> {
  const toggle = await screen.findByRole("switch", { name });
  await waitFor(() => expect(toggle).not.toBeDisabled());
  return toggle;
}

function lastPutBody(): unknown {
  const putCalls = fetchMock.mock.calls.filter(
    ([, init]) => init?.method === "PUT",
  );
  const lastPut = putCalls[putCalls.length - 1];
  return JSON.parse(String(lastPut?.[1]?.body));
}

beforeEach(() => {
  storedSettings = {};
  fetchMock.mockClear();
  vi.mocked(toast.success).mockClear();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GeneralSettings editor code lens and minimap switches", () => {
  it("shows code lens off and minimap on when nothing is stored", async () => {
    renderSettings();
    expect(await findEnabledSwitch("Code lens")).not.toBeChecked();
    expect(await findEnabledSwitch("Minimap")).toBeChecked();
  });

  it("reflects stored values", async () => {
    storedSettings = {
      "editor-code-lens-enabled": true,
      "editor-minimap-enabled": false,
    };
    renderSettings();
    expect(await findEnabledSwitch("Code lens")).toBeChecked();
    expect(await findEnabledSwitch("Minimap")).not.toBeChecked();
  });

  it("saves editor-code-lens-enabled=true and toasts when code lens is turned on", async () => {
    renderSettings();
    await userEvent.click(await findEnabledSwitch("Code lens"));

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("Code lens enabled"),
    );
    expect(lastPutBody()).toEqual({
      key: "editor-code-lens-enabled",
      value: true,
    });
  });

  it("saves editor-minimap-enabled=false and toasts when the minimap is turned off", async () => {
    renderSettings();
    await userEvent.click(await findEnabledSwitch("Minimap"));

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("Minimap disabled"),
    );
    expect(lastPutBody()).toEqual({
      key: "editor-minimap-enabled",
      value: false,
    });
  });
});

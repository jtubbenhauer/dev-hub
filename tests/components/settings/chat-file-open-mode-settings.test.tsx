import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import { GeneralSettings } from "@/components/settings/general-settings";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

HTMLElement.prototype.hasPointerCapture = () => false;
HTMLElement.prototype.releasePointerCapture = () => {};

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

function lastPutBody(): unknown {
  const putCalls = fetchMock.mock.calls.filter(
    ([, init]) => init?.method === "PUT",
  );
  const lastPut = putCalls[putCalls.length - 1];
  return JSON.parse(String(lastPut?.[1]?.body));
}

async function findEnabledTrigger(label: string): Promise<HTMLElement> {
  const trigger = await screen.findByRole("combobox", { name: label });
  await waitFor(() => expect(trigger).not.toBeDisabled());
  return trigger;
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

describe("GeneralSettings file open mode selects", () => {
  it.each(["Open chat files in", "Open Changes/Compare files in"])(
    "shows Workbench tab for '%s' when nothing is stored",
    async (label) => {
      renderSettings();
      expect(await findEnabledTrigger(label)).toHaveTextContent(
        "Workbench tab",
      );
    },
  );

  it("saves chat-file-open-mode=dialog when Dialog is picked", async () => {
    renderSettings();
    await userEvent.click(await findEnabledTrigger("Open chat files in"));
    await userEvent.click(
      await screen.findByRole("option", { name: "Dialog" }),
    );

    await waitFor(() =>
      expect(lastPutBody()).toEqual({
        key: "chat-file-open-mode",
        value: "dialog",
      }),
    );
  });

  it("keeps the stored value sidebar when Workbench tab is picked", async () => {
    storedSettings = { "chat-sidebar-tabs-open-mode": "dialog" };
    renderSettings();
    await userEvent.click(
      await findEnabledTrigger("Open Changes/Compare files in"),
    );
    await userEvent.click(
      await screen.findByRole("option", { name: "Workbench tab" }),
    );

    await waitFor(() =>
      expect(lastPutBody()).toEqual({
        key: "chat-sidebar-tabs-open-mode",
        value: "sidebar",
      }),
    );
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import { GeneralSettings } from "@/components/settings/general-settings";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

const fetchMock = vi.fn(
  async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const body = url.startsWith("/api/settings")
      ? init?.method === "PUT"
        ? { ok: true }
        : { "lsp-enabled": false }
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

beforeEach(() => {
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GeneralSettings TypeScript language server row", () => {
  it("saves lsp-enabled=true and toasts when the switch is turned on", async () => {
    renderSettings();
    const lspSwitch = await screen.findByRole("switch", {
      name: "TypeScript language server (experimental)",
    });
    await waitFor(() => expect(lspSwitch).not.toBeDisabled());
    expect(lspSwitch).not.toBeChecked();

    await userEvent.click(lspSwitch);

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        "TypeScript language server enabled",
      ),
    );
    const putCall = fetchMock.mock.calls.find(
      ([, init]) => init?.method === "PUT",
    );
    expect(JSON.parse(String(putCall?.[1]?.body))).toEqual({
      key: "lsp-enabled",
      value: true,
    });
  });
});

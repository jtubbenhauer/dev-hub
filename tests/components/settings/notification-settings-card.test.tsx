import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import { NotificationSettingsCard } from "@/components/settings/general-settings";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

function createFetchMock(putResponse: { ok: boolean; status: number }) {
  return vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      if (url.startsWith("/api/settings") && init?.method === "PUT") {
        return new Response(
          JSON.stringify(putResponse.ok ? { ok: true } : { error: "nope" }),
          {
            status: putResponse.status,
            headers: { "Content-Type": "application/json" },
          },
        );
      }
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  );
}

function renderCard() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <NotificationSettingsCard />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("NotificationSettingsCard tab status dot row", () => {
  describe("when the mutation succeeds", () => {
    const fetchMock = createFetchMock({ ok: true, status: 200 });

    beforeEach(() => {
      fetchMock.mockClear();
      vi.mocked(toast.success).mockClear();
      vi.stubGlobal("fetch", fetchMock);
    });

    it("renders a checked switch named Tab status dot by default", async () => {
      renderCard();
      const faviconSwitch = await screen.findByRole("switch", {
        name: /Tab status dot/,
      });
      await waitFor(() => expect(faviconSwitch).not.toBeDisabled());
      expect(faviconSwitch).toBeChecked();
    });

    it("saves notifications-favicon-enabled=false and toasts when turned off", async () => {
      renderCard();
      const faviconSwitch = await screen.findByRole("switch", {
        name: /Tab status dot/,
      });
      await waitFor(() => expect(faviconSwitch).not.toBeDisabled());

      await userEvent.click(faviconSwitch);

      await waitFor(() =>
        expect(toast.success).toHaveBeenCalledWith("Tab status dot disabled"),
      );
      const putCall = fetchMock.mock.calls.find(
        ([, init]) => init?.method === "PUT",
      );
      expect(String(putCall?.[1]?.body)).toBe(
        JSON.stringify({ key: "notifications-favicon-enabled", value: false }),
      );
    });
  });

  describe("when the mutation fails", () => {
    const fetchMock = createFetchMock({ ok: false, status: 500 });

    beforeEach(() => {
      fetchMock.mockClear();
      vi.mocked(toast.success).mockClear();
      vi.mocked(toast.error).mockClear();
      vi.stubGlobal("fetch", fetchMock);
    });

    it("does not call toast.success and does not crash", async () => {
      renderCard();
      const faviconSwitch = await screen.findByRole("switch", {
        name: /Tab status dot/,
      });
      await waitFor(() => expect(faviconSwitch).not.toBeDisabled());

      await userEvent.click(faviconSwitch);

      await waitFor(() => expect(toast.error).toHaveBeenCalled());
      expect(toast.success).not.toHaveBeenCalled();
      expect(
        screen.getByRole("switch", { name: /Tab status dot/ }),
      ).toBeInTheDocument();
    });
  });
});

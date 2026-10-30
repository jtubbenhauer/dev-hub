import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { SETTINGS_KEYS, useNotificationSettings } from "@/hooks/use-settings";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const mockFetch = vi.fn();

function mockSettingsResponse(settings: Record<string, unknown>) {
  mockFetch.mockResolvedValue({
    ok: true,
    status: 200,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => settings,
  });
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

async function renderLoadedHook() {
  const rendered = renderHook(() => useNotificationSettings(), {
    wrapper: createWrapper(),
  });
  await waitFor(() => expect(rendered.result.current.isLoading).toBe(false));
  return rendered;
}

describe("useNotificationSettings favicon status setting", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses the notifications-favicon-enabled settings key", () => {
    expect(SETTINGS_KEYS.NOTIFICATIONS_FAVICON_ENABLED).toBe(
      "notifications-favicon-enabled",
    );
  });

  it("defaults isFaviconStatusEnabled to true when the key is missing", async () => {
    mockSettingsResponse({});
    const { result } = await renderLoadedHook();
    expect(result.current.isFaviconStatusEnabled).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith("/api/settings");
  });

  it("is false when the setting is boolean false", async () => {
    mockSettingsResponse({ "notifications-favicon-enabled": false });
    const { result } = await renderLoadedHook();
    expect(result.current.isFaviconStatusEnabled).toBe(false);
  });

  it("keeps the existing sound and push fields", async () => {
    mockSettingsResponse({ "notifications-push-enabled": false });
    const { result } = await renderLoadedHook();
    expect(result.current.isSoundEnabled).toBe(true);
    expect(result.current.isPushEnabled).toBe(false);
    expect(result.current.isFaviconStatusEnabled).toBe(true);
  });
});

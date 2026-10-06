import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { SETTINGS_KEYS, useLspEnabledSetting } from "@/hooks/use-settings";

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
  const rendered = renderHook(() => useLspEnabledSetting(), {
    wrapper: createWrapper(),
  });
  await waitFor(() => expect(rendered.result.current.isLoading).toBe(false));
  return rendered;
}

describe("useLspEnabledSetting", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses the lsp-enabled settings key", () => {
    expect(SETTINGS_KEYS.LSP_ENABLED).toBe("lsp-enabled");
  });

  it("is enabled when the setting is boolean true", async () => {
    mockSettingsResponse({ "lsp-enabled": true });
    const { result } = await renderLoadedHook();
    expect(result.current.isLspEnabled).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith("/api/settings");
  });

  it("is disabled when the setting is missing", async () => {
    mockSettingsResponse({});
    const { result } = await renderLoadedHook();
    expect(result.current.isLspEnabled).toBe(false);
  });

  it("is disabled when the setting is boolean false", async () => {
    mockSettingsResponse({ "lsp-enabled": false });
    const { result } = await renderLoadedHook();
    expect(result.current.isLspEnabled).toBe(false);
  });

  it("is disabled when the setting is the string true", async () => {
    mockSettingsResponse({ "lsp-enabled": "true" });
    const { result } = await renderLoadedHook();
    expect(result.current.isLspEnabled).toBe(false);
  });

  it("is disabled while settings are loading", () => {
    mockFetch.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useLspEnabledSetting(), {
      wrapper: createWrapper(),
    });
    expect(result.current.isLoading).toBe(true);
    expect(result.current.isLspEnabled).toBe(false);
  });
});

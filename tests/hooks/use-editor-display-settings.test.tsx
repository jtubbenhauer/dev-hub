import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import {
  SETTINGS_KEYS,
  useCodeLensSetting,
  useMinimapSetting,
} from "@/hooks/use-settings";

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

async function renderLoadedCodeLensHook() {
  const rendered = renderHook(() => useCodeLensSetting(), {
    wrapper: createWrapper(),
  });
  await waitFor(() => expect(rendered.result.current.isLoading).toBe(false));
  return rendered;
}

async function renderLoadedMinimapHook() {
  const rendered = renderHook(() => useMinimapSetting(), {
    wrapper: createWrapper(),
  });
  await waitFor(() => expect(rendered.result.current.isLoading).toBe(false));
  return rendered;
}

beforeEach(() => {
  mockFetch.mockReset();
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useCodeLensSetting", () => {
  it("uses the editor-code-lens-enabled settings key", () => {
    expect(SETTINGS_KEYS.CODE_LENS_ENABLED).toBe("editor-code-lens-enabled");
  });

  it("is disabled when the setting is missing", async () => {
    mockSettingsResponse({});
    const { result } = await renderLoadedCodeLensHook();
    expect(result.current.isCodeLensEnabled).toBe(false);
  });

  it("is enabled when the setting is boolean true", async () => {
    mockSettingsResponse({ "editor-code-lens-enabled": true });
    const { result } = await renderLoadedCodeLensHook();
    expect(result.current.isCodeLensEnabled).toBe(true);
  });

  it("is disabled when the setting is boolean false", async () => {
    mockSettingsResponse({ "editor-code-lens-enabled": false });
    const { result } = await renderLoadedCodeLensHook();
    expect(result.current.isCodeLensEnabled).toBe(false);
  });

  it.each(["true", 1, null, { enabled: true }])(
    "falls back to disabled for the non-boolean value %j",
    async (junk) => {
      mockSettingsResponse({ "editor-code-lens-enabled": junk });
      const { result } = await renderLoadedCodeLensHook();
      expect(result.current.isCodeLensEnabled).toBe(false);
    },
  );

  it("is disabled while settings are loading", () => {
    mockFetch.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useCodeLensSetting(), {
      wrapper: createWrapper(),
    });
    expect(result.current.isLoading).toBe(true);
    expect(result.current.isCodeLensEnabled).toBe(false);
  });
});

describe("useMinimapSetting", () => {
  it("uses the editor-minimap-enabled settings key", () => {
    expect(SETTINGS_KEYS.MINIMAP_ENABLED).toBe("editor-minimap-enabled");
  });

  it("is enabled when the setting is missing", async () => {
    mockSettingsResponse({});
    const { result } = await renderLoadedMinimapHook();
    expect(result.current.isMinimapEnabled).toBe(true);
  });

  it("is enabled when the setting is boolean true", async () => {
    mockSettingsResponse({ "editor-minimap-enabled": true });
    const { result } = await renderLoadedMinimapHook();
    expect(result.current.isMinimapEnabled).toBe(true);
  });

  it("is disabled when the setting is boolean false", async () => {
    mockSettingsResponse({ "editor-minimap-enabled": false });
    const { result } = await renderLoadedMinimapHook();
    expect(result.current.isMinimapEnabled).toBe(false);
  });

  it.each(["false", 0, null, { enabled: false }])(
    "falls back to enabled for the non-boolean value %j",
    async (junk) => {
      mockSettingsResponse({ "editor-minimap-enabled": junk });
      const { result } = await renderLoadedMinimapHook();
      expect(result.current.isMinimapEnabled).toBe(true);
    },
  );

  it("is enabled while settings are loading", () => {
    mockFetch.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useMinimapSetting(), {
      wrapper: createWrapper(),
    });
    expect(result.current.isLoading).toBe(true);
    expect(result.current.isMinimapEnabled).toBe(true);
  });
});

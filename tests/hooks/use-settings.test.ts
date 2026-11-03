import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_CHAT_FILE_OPEN_MODE,
  resolveChatFileOpenMode,
  SETTINGS_KEYS,
  TERMINAL_FONT_OPTIONS,
  terminalFontFamily,
  useSettings,
  useSettingsMutation,
  useWorkbenchChordsSetting,
} from "@/hooks/use-settings";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

function createQueryWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function QueryWrapper({ children }: { readonly children: ReactNode }) {
    return createElement(
      QueryClientProvider,
      { client: queryClient },
      children,
    );
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("resolveChatFileOpenMode", () => {
  it("defaults to the sidebar when no preference has been saved", () => {
    expect(resolveChatFileOpenMode(undefined)).toBe(
      DEFAULT_CHAT_FILE_OPEN_MODE,
    );
    expect(DEFAULT_CHAT_FILE_OPEN_MODE).toBe("sidebar");
  });

  it("returns dialog only for the persisted dialog preference", () => {
    expect(resolveChatFileOpenMode("dialog")).toBe("dialog");
    expect(resolveChatFileOpenMode("invalid")).toBe("sidebar");
  });
});

describe("settings response errors", () => {
  it("preserves unexpected errors while reading a failed GET response", async () => {
    const bodyReadError = new TypeError("response stream failed");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: vi.fn().mockRejectedValue(bodyReadError),
      }),
    );

    const { result } = renderHook(() => useSettings(), {
      wrapper: createQueryWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBe(bodyReadError);
  });

  it("preserves unexpected errors while reading a failed PUT response", async () => {
    const bodyReadError = new TypeError("response stream failed");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: vi.fn().mockRejectedValue(bodyReadError),
      }),
    );
    const { result } = renderHook(() => useSettingsMutation(), {
      wrapper: createQueryWrapper(),
    });

    await act(async () => {
      await expect(
        result.current.mutateAsync({ key: "theme", value: "dark" }),
      ).rejects.toBe(bodyReadError);
    });
  });
});

describe("terminalFontFamily", () => {
  it("resolves the JetBrains Mono Nerd Font option", () => {
    expect(terminalFontFamily("jetbrains-mono-nerd")).toBe(
      "JetBrainsMonoNerdFontMono, monospace",
    );
  });

  it("resolves the existing font options", () => {
    expect(terminalFontFamily("geist-mono")).toBe(
      "var(--font-geist-mono), monospace",
    );
    expect(terminalFontFamily("ibm-plex-mono-nerd")).toBe(
      "BlexMonoNerdFontMono, monospace",
    );
  });

  it("exposes the JetBrains Mono option in TERMINAL_FONT_OPTIONS", () => {
    const option = TERMINAL_FONT_OPTIONS.find(
      (o) => o.value === "jetbrains-mono-nerd",
    );
    expect(option).toEqual({
      value: "jetbrains-mono-nerd",
      label: "JetBrains Mono Nerd Font",
      fontFamily: "JetBrainsMonoNerdFontMono, monospace",
    });
  });
});

function stubSettingsFetch(settings: Record<string, unknown>) {
  const fetchMock = vi.fn(
    async (_input: RequestInfo | URL, init?: RequestInit) =>
      Response.json(init?.method === "PUT" ? { ok: true } : settings),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("useWorkbenchChordsSetting", () => {
  it("stores the switch under the workbench-chords-enabled key", () => {
    expect(SETTINGS_KEYS.WORKBENCH_CHORDS_ENABLED).toBe(
      "workbench-chords-enabled",
    );
  });

  it("is on while the settings are still loading", () => {
    // Given
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => {})),
    );

    // When
    const { result } = renderHook(() => useWorkbenchChordsSetting(), {
      wrapper: createQueryWrapper(),
    });

    // Then
    expect(result.current.isEnabled).toBe(true);
  });

  it("is on when the switch was never saved", async () => {
    // Given
    const fetchMock = stubSettingsFetch({});

    // When
    const { result } = renderHook(() => useWorkbenchChordsSetting(), {
      wrapper: createQueryWrapper(),
    });

    // Then
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(result.current.isEnabled).toBe(true);
  });

  it("is off once the switch is saved as false", async () => {
    // Given
    stubSettingsFetch({ "workbench-chords-enabled": false });

    // When
    const { result } = renderHook(() => useWorkbenchChordsSetting(), {
      wrapper: createQueryWrapper(),
    });

    // Then
    await waitFor(() => expect(result.current.isEnabled).toBe(false));
  });

  it("saves the switch when it is turned off", async () => {
    // Given
    const fetchMock = stubSettingsFetch({});
    const { result } = renderHook(() => useWorkbenchChordsSetting(), {
      wrapper: createQueryWrapper(),
    });

    // When
    act(() => result.current.setIsEnabled(false));

    // Then
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.find(([, init]) => init?.method === "PUT"),
      ).toBeDefined(),
    );
    const putCall = fetchMock.mock.calls.find(
      ([, init]) => init?.method === "PUT",
    );
    expect(JSON.parse(String(putCall?.[1]?.body))).toEqual({
      key: "workbench-chords-enabled",
      value: false,
    });
  });
});

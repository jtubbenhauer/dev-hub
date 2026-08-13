import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_CHAT_FILE_OPEN_MODE,
  resolveChatFileOpenMode,
  useSettings,
  useSettingsMutation,
} from "@/hooks/use-settings";

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

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QuickActions } from "@/components/dashboard/quick-actions";

const navigation = vi.hoisted(() => ({
  push: vi.fn<(href: string) => void>(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: navigation.push }),
}));

function renderQuickActions() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <QuickActions />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  // The saved actions never arrive, so the defaults stay on screen.
  vi.stubGlobal(
    "fetch",
    vi.fn(() => new Promise<Response>(() => {})),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  navigation.push.mockReset();
});

describe("QuickActions", () => {
  it("opens a chat in the workbench from the default Open Chat action", async () => {
    // Given
    renderQuickActions();

    // When
    await userEvent.click(screen.getByRole("button", { name: "Open Chat" }));

    // Then
    expect(navigation.push).toHaveBeenCalledExactlyOnceWith("/?open=chat");
  });
});

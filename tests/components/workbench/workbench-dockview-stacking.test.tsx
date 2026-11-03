import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { WorkbenchDockview } from "@/components/workbench/workbench-dockview";
import { useWorkbenchStore } from "@/stores/workbench-store";

vi.mock("@/components/chat/chat-interface", () => ({
  ChatInterface: () => <div data-testid="chat-interface" />,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("@/components/file-picker/file-picker", () => ({
  useFilePicker: () => ({
    isOpen: false,
    open: vi.fn(),
    close: vi.fn(),
    toggle: vi.fn(),
  }),
}));

beforeEach(() => {
  localStorage.clear();
  useWorkbenchStore.setState(useWorkbenchStore.getInitialState(), true);
});

afterEach(() => {
  cleanup();
});

describe("WorkbenchDockview stacking", () => {
  it("keeps dockview's z-indexed sashes below app overlays such as the terminal drawer", () => {
    // When
    const { container } = render(
      <QueryClientProvider client={new QueryClient()}>
        <WorkbenchDockview workspaceId="w1" isMobile={false} />
      </QueryClientProvider>,
    );

    // Then: `isolate` scopes dockview's z-index 99 sashes to the workbench.
    const shell = container.querySelector(".dv-shell");
    expect(shell?.closest(".isolate")).not.toBeNull();
  });
});

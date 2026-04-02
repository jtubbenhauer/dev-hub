import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Header } from "@/components/layout/header";
import { SidebarProvider } from "@/components/ui/sidebar";

vi.mock("next-auth/react", () => ({
  signOut: vi.fn(),
  useSession: vi.fn(() => ({ data: null, status: "unauthenticated" })),
}));

vi.mock("@/stores/command-store", () => ({
  useCommandStore: vi.fn(
    (
      selector: (s: {
        setDrawerOpen: ReturnType<typeof vi.fn>;
        sessions: Record<string, unknown>;
      }) => unknown,
    ) => selector({ setDrawerOpen: vi.fn(), sessions: {} }),
  ),
}));

vi.mock("@/components/providers/command-palette-provider", () => ({
  useCommandPalette: vi.fn(() => ({ toggle: vi.fn() })),
}));

vi.mock("@/components/layout/workspace-switcher", () => ({
  WorkspaceSwitcher: () => <div data-testid="workspace-switcher" />,
}));

vi.mock("@/components/layout/git-status-bar", () => ({
  GitStatusBar: () => null,
}));

vi.mock("@/components/layout/system-indicator", () => ({
  SystemIndicator: () => null,
}));

vi.mock("@/components/command-runner/command-drawer", () => ({
  CommandDrawer: () => null,
}));

vi.mock("@/components/terminal/terminal-drawer", () => ({
  TerminalDrawer: () => null,
}));

vi.mock("@/components/workspace/provider-creation-indicator", () => ({
  ProviderCreationIndicator: () => null,
}));

globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

function renderHeader() {
  return render(
    <SidebarProvider>
      <Header />
    </SidebarProvider>,
  );
}

describe("Header", () => {
  it("renders SidebarTrigger with data-sidebar='trigger'", () => {
    renderHeader();
    const trigger = document.querySelector("[data-sidebar='trigger']");
    expect(trigger).toBeInTheDocument();
  });

  it("SidebarTrigger has class 'hidden md:inline-flex'", () => {
    renderHeader();
    const trigger = document.querySelector("[data-sidebar='trigger']");
    expect(trigger).toHaveClass("hidden");
    expect(trigger).toHaveClass("md:inline-flex");
  });

  it("renders workspace switcher area", () => {
    renderHeader();
    expect(screen.getByTestId("workspace-switcher")).toBeInTheDocument();
  });

  it("renders search button with command palette title", () => {
    renderHeader();
    const searchBtn = screen.getByTitle("Command palette (Ctrl+,)");
    expect(searchBtn).toBeInTheDocument();
  });

  it("renders logout button", () => {
    renderHeader();
    const logoutBtns = screen.getAllByRole("button");
    const hasLogoutIcon = logoutBtns.some(
      (btn) => btn.querySelector("svg") !== null,
    );
    expect(hasLogoutIcon).toBe(true);
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { SidebarProvider } from "@/components/ui/sidebar";

const mockPathname = vi.fn(() => "/");
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => mockPathname(),
}));

vi.mock("next/link", () => ({
  __esModule: true,
  default: ({
    href,
    children,
    ...rest
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const mockUseCommand = vi.fn();
const mockUseLeaderAction = vi.fn();
vi.mock("@/hooks/use-command", () => ({
  useCommand: (...args: unknown[]) => mockUseCommand(...args),
}));
vi.mock("@/hooks/use-leader-action", () => ({
  useLeaderAction: (...args: unknown[]) => mockUseLeaderAction(...args),
}));

vi.mock("@/components/providers/command-palette-provider", () => ({
  useCommandPalette: vi.fn(() => ({ open: vi.fn(), toggle: vi.fn() })),
}));
vi.mock("@/components/file-picker/file-picker", () => ({
  useFilePicker: vi.fn(() => ({ open: vi.fn() })),
}));
vi.mock("@/components/session-picker/session-picker", () => ({
  useSessionPicker: vi.fn(() => ({ open: vi.fn() })),
}));
vi.mock("@/components/task-picker/task-picker", () => ({
  useTaskPicker: vi.fn(() => ({ open: vi.fn() })),
}));
vi.mock("@/components/git-picker/git-picker", () => ({
  useGitPicker: vi.fn(() => ({ open: vi.fn() })),
}));
vi.mock("@/components/workspace-picker/workspace-picker", () => ({
  useWorkspacePicker: vi.fn(() => ({ open: vi.fn() })),
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

function renderSidebar() {
  return render(
    <SidebarProvider>
      <AppSidebar />
    </SidebarProvider>,
  );
}

describe("AppSidebar", () => {
  beforeEach(() => {
    mockPathname.mockReturnValue("/");
    mockUseCommand.mockClear();
    mockUseLeaderAction.mockClear();
  });

  it("renders all 8 navigation items with correct labels", () => {
    renderSidebar();

    const labels = [
      "Dash",
      "Chat",
      "Files",
      "Git",
      "Term",
      "Tasks",
      "Repos",
      "Settings",
    ];
    for (const label of labels) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("renders Sidebar with collapsible='offcanvas' (data-collapsible attribute)", () => {
    render(
      <SidebarProvider defaultOpen={false}>
        <AppSidebar />
      </SidebarProvider>,
    );

    const sidebar = document.querySelector("[data-collapsible='offcanvas']");
    expect(sidebar).toBeInTheDocument();
  });

  it("renders SidebarRail with data-sidebar='rail' attribute", () => {
    renderSidebar();

    const rail = document.querySelector("[data-sidebar='rail']");
    expect(rail).toBeInTheDocument();
  });

  it("marks Chat nav item as active when pathname is /chat", () => {
    mockPathname.mockReturnValue("/chat");
    renderSidebar();

    // data-active="true" is set by SidebarMenuButton when isActive prop is true
    const activeButtons = document.querySelectorAll("[data-active='true']");
    const chatActive = Array.from(activeButtons).some((el) =>
      el.textContent?.includes("Chat"),
    );
    expect(chatActive).toBe(true);
  });

  it("marks Dash active but NOT Chat when pathname is /", () => {
    mockPathname.mockReturnValue("/");
    renderSidebar();

    const activeButtons = document.querySelectorAll("[data-active='true']");
    const dashActive = Array.from(activeButtons).some((el) =>
      el.textContent?.includes("Dash"),
    );
    const chatActive = Array.from(activeButtons).some((el) =>
      el.textContent?.includes("Chat"),
    );

    expect(dashActive).toBe(true);
    expect(chatActive).toBe(false);
  });

  it("calls useCommand and useLeaderAction hooks on render", () => {
    renderSidebar();

    expect(mockUseCommand).toHaveBeenCalled();
    expect(mockUseLeaderAction).toHaveBeenCalled();
  });
});

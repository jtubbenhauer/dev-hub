import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { LucideIcon } from "lucide-react";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { NAV_ITEMS } from "@/components/layout/nav-items";
import { SidebarProvider } from "@/components/ui/sidebar";
import type { FocusRecentInWorkbenchInput } from "@/lib/workbench/open-in-workbench";

const mockPathname = vi.fn(() => "/");
const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
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

const mockUseLeaderAction = vi.fn();
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
const mockOpenFindInFiles = vi.fn();
vi.mock("@/lib/files/open-find-in-files", () => ({
  openFindInFiles: (...args: unknown[]) => mockOpenFindInFiles(...args),
}));
const workbenchOpeners = vi.hoisted(() => ({
  focusRecentInWorkbench: vi.fn<(input: FocusRecentInWorkbenchInput) => void>(),
}));
vi.mock("@/lib/workbench/open-in-workbench", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/lib/workbench/open-in-workbench")
  >()),
  focusRecentInWorkbench: workbenchOpeners.focusRecentInWorkbench,
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

interface LeaderRegistration {
  readonly action: {
    readonly id: string;
    readonly label: string;
    readonly icon?: LucideIcon;
  };
  readonly handler: () => void;
}

const NAV_LINKS = [
  { label: "Work", href: "/" },
  { label: "Dash", href: "/dashboard" },
  { label: "Git", href: "/git" },
  { label: "PRs", href: "/prs" },
  { label: "Tasks", href: "/tasks" },
  { label: "Repos", href: "/workspaces" },
  { label: "Settings", href: "/settings" },
];

const NAV_LEADER_ACTIONS = [
  { actionId: "nav:workbench", href: "/" },
  { actionId: "nav:dashboard", href: "/dashboard" },
  { actionId: "nav:git", href: "/git" },
  { actionId: "nav:prs", href: "/prs" },
  { actionId: "nav:tasks", href: "/tasks" },
  { actionId: "nav:repos", href: "/workspaces" },
  { actionId: "nav:settings", href: "/settings" },
];

function renderSidebar() {
  return render(
    <SidebarProvider>
      <AppSidebar />
    </SidebarProvider>,
  );
}

function leaderRegistrations(): LeaderRegistration[] {
  return mockUseLeaderAction.mock.calls[0][0];
}

function leaderRegistration(actionId: string): LeaderRegistration {
  const registration = leaderRegistrations().find(
    (candidate) => candidate.action.id === actionId,
  );
  if (!registration) throw new Error(`${actionId} was never registered`);
  return registration;
}

function leaderHandler(actionId: string): () => void {
  return leaderRegistration(actionId).handler;
}

function activeNavLabels(): string[] {
  return Array.from(document.querySelectorAll("[data-active='true']")).map(
    (element) => element.textContent ?? "",
  );
}

describe("AppSidebar", () => {
  beforeEach(() => {
    mockPathname.mockReturnValue("/");
    mockUseLeaderAction.mockClear();
    pushMock.mockClear();
    workbenchOpeners.focusRecentInWorkbench.mockClear();
  });

  it("renders the Work, Dash, Git, PRs, Tasks, Repos and Settings links in order", () => {
    renderSidebar();

    const links = screen.getAllByRole("link").map((link) => ({
      label: link.textContent,
      href: link.getAttribute("href"),
    }));
    expect(links).toEqual(NAV_LINKS);
  });

  it.each([
    { pathname: "/", activeLabel: "Work" },
    { pathname: "/dashboard", activeLabel: "Dash" },
    { pathname: "/git", activeLabel: "Git" },
    { pathname: "/workspaces/ws-1", activeLabel: "Repos" },
  ])(
    "marks only $activeLabel active when pathname is $pathname",
    ({ pathname, activeLabel }) => {
      mockPathname.mockReturnValue(pathname);

      renderSidebar();

      expect(activeNavLabels()).toEqual([activeLabel]);
    },
  );

  it.each(NAV_LEADER_ACTIONS)(
    "routes the $actionId leader action to $href",
    ({ actionId, href }) => {
      renderSidebar();

      leaderHandler(actionId)();

      expect(pushMock).toHaveBeenCalledExactlyOnceWith(href);
    },
  );

  it.each(NAV_LEADER_ACTIONS)(
    "gives the $actionId leader action the icon of the $href link for the palette",
    ({ actionId, href }) => {
      renderSidebar();

      expect(leaderRegistration(actionId).action.icon).toBe(
        NAV_ITEMS.find((item) => item.href === href)?.icon,
      );
    },
  );

  it.each([
    { actionId: "nav:chat", kind: "chat" },
    { actionId: "nav:files", kind: "file" },
    { actionId: "nav:terminal", kind: "terminal" },
  ] as const)(
    "focuses the most recent $kind tab from the $actionId leader action",
    ({ actionId, kind }) => {
      renderSidebar();

      leaderHandler(actionId)();

      expect(workbenchOpeners.focusRecentInWorkbench).toHaveBeenCalledOnce();
      expect(
        workbenchOpeners.focusRecentInWorkbench.mock.lastCall?.[0].kind,
      ).toBe(kind);
      expect(pushMock).not.toHaveBeenCalled();
    },
  );

  it("routes the focus opener's navigation through the router", () => {
    renderSidebar();
    leaderHandler("nav:terminal")();

    workbenchOpeners.focusRecentInWorkbench.mock.lastCall?.[0].navigate(
      "/?open=terminal",
    );

    expect(pushMock).toHaveBeenCalledExactlyOnceWith("/?open=terminal");
  });

  it("registers a global:find-in-files leader action with the current pathname", () => {
    mockPathname.mockReturnValue("/git");
    mockOpenFindInFiles.mockClear();
    renderSidebar();

    leaderHandler("global:find-in-files")();

    expect(mockOpenFindInFiles).toHaveBeenCalledWith(
      expect.objectContaining({ pathname: "/git" }),
    );
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

  it("renders nav items with vertical icon+label layout", () => {
    renderSidebar();

    const labels = screen.getAllByText(
      /^(Work|Dash|Git|PRs|Tasks|Repos|Settings)$/,
    );
    expect(labels).toHaveLength(NAV_LINKS.length);
    for (const label of labels) {
      expect(label).toHaveClass("text-[10px]");
    }
  });
});

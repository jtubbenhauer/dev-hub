import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  TaskPickerProvider,
  TaskPickerDialog,
  useTaskPicker,
} from "@/components/task-picker/task-picker";
import type { ClickUpTask } from "@/types";

const mockPush = vi.fn();
const mockPathname = vi.fn(() => "/chat");
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
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

const mockUseMyClickUpTasks =
  vi.fn<
    () => {
      data: ClickUpTask[] | undefined;
      isLoading: boolean;
      error: Error | null;
    }
  >();
const mockUseClickUpSearch =
  vi.fn<
    () => {
      data: ClickUpTask[] | undefined;
      isLoading: boolean;
      error: Error | null;
    }
  >();
vi.mock("@/hooks/use-clickup", () => ({
  useMyClickUpTasks: () => mockUseMyClickUpTasks(),
  useClickUpSearch: () => mockUseClickUpSearch(),
}));

const mockUseClickUpSettings =
  vi.fn<() => { isConfigured: boolean; isLoading: boolean }>();
vi.mock("@/hooks/use-settings", () => ({
  useClickUpSettings: () => mockUseClickUpSettings(),
}));

globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

Element.prototype.scrollIntoView = () => {};

function makeTask(
  id: string,
  name: string,
  dateUpdated: string,
  priority?: "urgent" | "high" | "normal" | "low",
  listName?: string,
): ClickUpTask {
  return {
    id,
    name,
    date_updated: dateUpdated,
    custom_id: null,
    due_date: null,
    date_created: "0",
    date_closed: null,
    url: `https://app.clickup.com/t/${id}`,
    status: { status: "open", color: "#87909e", type: "open" },
    priority: priority ? { priority, id: "1", color: "#f00" } : null,
    assignees: [],
    tags: [],
    list: { id: "list-1", name: listName ?? "Backlog" },
    folder: { id: "folder-1", name: "Folder" },
    space: { id: "space-1" },
  };
}

function OpenButton() {
  const { open } = useTaskPicker();
  return (
    <button type="button" onClick={open}>
      Open Picker
    </button>
  );
}

function renderPicker() {
  return render(
    <TaskPickerProvider>
      <OpenButton />
      <TaskPickerDialog />
    </TaskPickerProvider>,
  );
}

beforeEach(() => {
  mockPush.mockClear();
  mockPathname.mockReturnValue("/chat");

  mockUseClickUpSettings.mockReturnValue({
    isConfigured: true,
    isLoading: false,
  });
  mockUseMyClickUpTasks.mockReturnValue({
    data: [],
    isLoading: false,
    error: null,
  });
  mockUseClickUpSearch.mockReturnValue({
    data: undefined,
    isLoading: false,
    error: null,
  });
});

describe("TaskPickerDialog", () => {
  it("does not render dialog content when closed", () => {
    mockUseMyClickUpTasks.mockReturnValue({
      data: [makeTask("t1", "Some Task", "2000")],
      isLoading: false,
      error: null,
    });
    renderPicker();

    expect(
      screen.queryByPlaceholderText("Search tasks..."),
    ).not.toBeInTheDocument();
  });

  it("renders dialog content when opened", async () => {
    mockUseMyClickUpTasks.mockReturnValue({
      data: [makeTask("t1", "Some Task", "2000")],
      isLoading: false,
      error: null,
    });
    renderPicker();

    await userEvent.click(screen.getByText("Open Picker"));

    expect(screen.getByPlaceholderText("Search tasks...")).toBeInTheDocument();
  });

  it("shows assigned tasks by default", async () => {
    mockUseMyClickUpTasks.mockReturnValue({
      data: [
        makeTask("t1", "Fix login bug", "2000"),
        makeTask("t2", "Add dark mode", "1000"),
      ],
      isLoading: false,
      error: null,
    });
    renderPicker();

    await userEvent.click(screen.getByText("Open Picker"));

    expect(screen.getByText("Fix login bug")).toBeInTheDocument();
    expect(screen.getByText("Add dark mode")).toBeInTheDocument();
  });

  it("shows task priority dot, status badge, and list name", async () => {
    mockUseMyClickUpTasks.mockReturnValue({
      data: [makeTask("t1", "Important Task", "2000", "high", "Sprint 1")],
      isLoading: false,
      error: null,
    });
    renderPicker();

    await userEvent.click(screen.getByText("Open Picker"));

    expect(screen.getByText("Important Task")).toBeInTheDocument();
    expect(screen.getByText("open")).toBeInTheDocument();
    expect(screen.getByText("Sprint 1")).toBeInTheDocument();
  });

  it("fuzzy-filters tasks when typing < 2 chars", async () => {
    mockUseMyClickUpTasks.mockReturnValue({
      data: [
        makeTask("t1", "Fix login bug", "2000"),
        makeTask("t2", "Add dark mode", "1000"),
      ],
      isLoading: false,
      error: null,
    });
    renderPicker();

    await userEvent.click(screen.getByText("Open Picker"));
    await userEvent.type(screen.getByPlaceholderText("Search tasks..."), "F");

    const buttons = screen
      .getAllByRole("button")
      .filter((btn) => btn.getAttribute("data-index") !== null);
    expect(
      buttons.some((btn) => btn.textContent?.includes("Fix login bug")),
    ).toBe(true);
    expect(
      buttons.some((btn) => btn.textContent?.includes("Add dark mode")),
    ).toBe(false);
  });

  it("switches to server search when typing >= 2 chars", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    mockUseMyClickUpTasks.mockReturnValue({
      data: [makeTask("t1", "Fix login bug", "2000")],
      isLoading: false,
      error: null,
    });
    mockUseClickUpSearch.mockReturnValue({
      data: [makeTask("t3", "Server result", "3000")],
      isLoading: false,
      error: null,
    });
    renderPicker();

    await user.click(screen.getByText("Open Picker"));
    await user.type(screen.getByPlaceholderText("Search tasks..."), "Fi");

    await act(() => {
      vi.advanceTimersByTime(350);
    });

    expect(screen.getByText("Server result")).toBeInTheDocument();

    vi.useRealTimers();
  });

  it("shows loading indicator during search", async () => {
    mockUseMyClickUpTasks.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    });
    renderPicker();

    await userEvent.click(screen.getByText("Open Picker"));

    const spinner = document.querySelector(".animate-spin");
    expect(spinner).toBeTruthy();
  });

  it("shows 'No tasks found' when results are empty", async () => {
    mockUseMyClickUpTasks.mockReturnValue({
      data: [],
      isLoading: false,
      error: null,
    });
    renderPicker();

    await userEvent.click(screen.getByText("Open Picker"));

    expect(screen.getByText("No tasks found")).toBeInTheDocument();
  });

  it("shows error message when API fails", async () => {
    mockUseMyClickUpTasks.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error("ClickUp API rate limit exceeded"),
    });
    renderPicker();

    await userEvent.click(screen.getByText("Open Picker"));

    expect(
      screen.getByText("ClickUp API rate limit exceeded"),
    ).toBeInTheDocument();
  });

  it("shows 'ClickUp not configured' message with Settings link", async () => {
    mockUseClickUpSettings.mockReturnValue({
      isConfigured: false,
      isLoading: false,
    });
    renderPicker();

    await userEvent.click(screen.getByText("Open Picker"));

    expect(screen.getByText("ClickUp not configured")).toBeInTheDocument();
    const settingsLink = screen.getByText("Configure in Settings");
    expect(settingsLink).toBeInTheDocument();
    expect(settingsLink.closest("a")).toHaveAttribute("href", "/settings");
  });

  it("selecting a task dispatches CustomEvent and navigates to /tasks", async () => {
    const task = makeTask("t1", "My Task", "2000");
    mockUseMyClickUpTasks.mockReturnValue({
      data: [task],
      isLoading: false,
      error: null,
    });
    mockPathname.mockReturnValue("/chat");
    renderPicker();

    const eventSpy = vi.fn();
    window.addEventListener("devhub:select-task", eventSpy);

    await userEvent.click(screen.getByText("Open Picker"));
    await userEvent.click(screen.getByText("My Task"));

    expect(mockPush).toHaveBeenCalledWith("/tasks");
    expect(eventSpy).toHaveBeenCalledTimes(1);
    expect((eventSpy.mock.calls[0][0] as CustomEvent).detail.taskId).toBe("t1");
    expect(
      screen.queryByPlaceholderText("Search tasks..."),
    ).not.toBeInTheDocument();

    window.removeEventListener("devhub:select-task", eventSpy);
  });

  it("does not navigate when already on /tasks", async () => {
    mockPathname.mockReturnValue("/tasks");
    mockUseMyClickUpTasks.mockReturnValue({
      data: [makeTask("t1", "My Task", "2000")],
      isLoading: false,
      error: null,
    });
    renderPicker();

    await userEvent.click(screen.getByText("Open Picker"));
    await userEvent.click(screen.getByText("My Task"));

    expect(mockPush).not.toHaveBeenCalled();
  });

  it("keyboard: ArrowDown + Enter selects correct task", async () => {
    mockUseMyClickUpTasks.mockReturnValue({
      data: [
        makeTask("t1", "First Task", "2000"),
        makeTask("t2", "Second Task", "1000"),
      ],
      isLoading: false,
      error: null,
    });
    renderPicker();

    const eventSpy = vi.fn();
    window.addEventListener("devhub:select-task", eventSpy);

    await userEvent.click(screen.getByText("Open Picker"));
    await userEvent.keyboard("{ArrowDown}{Enter}");

    expect(eventSpy).toHaveBeenCalledTimes(1);
    expect((eventSpy.mock.calls[0][0] as CustomEvent).detail.taskId).toBe("t2");

    window.removeEventListener("devhub:select-task", eventSpy);
  });

  it("keyboard: Escape closes dialog", async () => {
    mockUseMyClickUpTasks.mockReturnValue({
      data: [makeTask("t1", "Some Task", "2000")],
      isLoading: false,
      error: null,
    });
    renderPicker();

    await userEvent.click(screen.getByText("Open Picker"));
    expect(screen.getByPlaceholderText("Search tasks...")).toBeInTheDocument();

    await userEvent.keyboard("{Escape}");
    expect(
      screen.queryByPlaceholderText("Search tasks..."),
    ).not.toBeInTheDocument();
  });

  it("keyboard: ArrowUp moves selection up", async () => {
    mockUseMyClickUpTasks.mockReturnValue({
      data: [
        makeTask("t1", "First Task", "2000"),
        makeTask("t2", "Second Task", "1000"),
        makeTask("t3", "Third Task", "500"),
      ],
      isLoading: false,
      error: null,
    });
    renderPicker();

    const eventSpy = vi.fn();
    window.addEventListener("devhub:select-task", eventSpy);

    await userEvent.click(screen.getByText("Open Picker"));
    await userEvent.keyboard("{ArrowDown}{ArrowDown}{ArrowUp}{Enter}");

    expect(eventSpy).toHaveBeenCalledTimes(1);
    expect((eventSpy.mock.calls[0][0] as CustomEvent).detail.taskId).toBe("t2");

    window.removeEventListener("devhub:select-task", eventSpy);
  });
});

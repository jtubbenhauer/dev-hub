import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { WorkbenchLauncher } from "@/components/workbench/workbench-launcher";
import {
  registerWorkbenchController,
  type WorkbenchController,
} from "@/lib/workbench/workbench-controller-registry";

const openFilePicker = vi.fn();

vi.mock("@/components/file-picker/file-picker", () => ({
  useFilePicker: () => ({
    isOpen: false,
    open: openFilePicker,
    close: vi.fn(),
    toggle: vi.fn(),
  }),
}));

function createFakeController() {
  return {
    workspaceId: "ws-1",
    openTab: vi.fn(() => "tab-opened"),
    openNewTerminal: vi.fn(() => "tab-terminal"),
    openNewChat: vi.fn(() => "tab-chat"),
    closeTabs: vi.fn(),
    focusMostRecent: vi.fn(() => false),
    openContextSidebar: vi.fn(),
    revealFolder: vi.fn(),
    runCommand: vi.fn(),
  } satisfies WorkbenchController;
}

const unregisterControllers: (() => void)[] = [];

function renderLauncher(groupId: string | null) {
  const controller = createFakeController();
  unregisterControllers.push(registerWorkbenchController(controller));
  render(<WorkbenchLauncher groupId={groupId} />);
  return controller;
}

afterEach(() => {
  for (const unregister of unregisterControllers.splice(0)) unregister();
  openFilePicker.mockClear();
});

describe("WorkbenchLauncher", () => {
  it("opens a new terminal in its group from the button", async () => {
    // Given
    const controller = renderLauncher("group-2");

    // When
    await userEvent.click(
      screen.getByRole("button", { name: /new terminal/i }),
    );

    // Then
    expect(controller.openNewTerminal).toHaveBeenCalledExactlyOnceWith({
      groupId: "group-2",
    });
  });

  it("opens a new chat in its group from the button", async () => {
    // Given
    const controller = renderLauncher("group-2");

    // When
    await userEvent.click(screen.getByRole("button", { name: /new chat/i }));

    // Then
    expect(controller.openNewChat).toHaveBeenCalledExactlyOnceWith({
      groupId: "group-2",
    });
  });

  it("opens the file picker from the button", async () => {
    // Given
    renderLauncher("group-2");

    // When
    await userEvent.click(screen.getByRole("button", { name: /open file/i }));

    // Then
    expect(openFilePicker).toHaveBeenCalledOnce();
  });

  it("runs the matching action for t, c and f while it has focus", async () => {
    // Given
    const controller = renderLauncher(null);
    screen.getByRole("group", { name: "New tab" }).focus();

    // When
    await userEvent.keyboard("tcf");

    // Then
    expect(controller.openNewTerminal).toHaveBeenCalledExactlyOnceWith({
      groupId: null,
    });
    expect(controller.openNewChat).toHaveBeenCalledExactlyOnceWith({
      groupId: null,
    });
    expect(openFilePicker).toHaveBeenCalledOnce();
  });

  it("ignores the shortcut keys when a modifier is held", async () => {
    // Given
    const controller = renderLauncher("group-2");
    screen.getByRole("group", { name: "New tab" }).focus();

    // When
    await userEvent.keyboard("{Control>}t{/Control}{Meta>}c{/Meta}");

    // Then
    expect(controller.openNewTerminal).not.toHaveBeenCalled();
    expect(controller.openNewChat).not.toHaveBeenCalled();
  });
});

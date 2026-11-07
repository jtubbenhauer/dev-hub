import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WorkbenchTabSwitcher } from "@/components/workbench/workbench-tab-switcher";

const CHAT_PANEL = {
  id: "chat-1",
  title: "Fix mobile tabs",
  params: { kind: "chat", workspaceId: "w1", sessionId: "s1" },
};
const TERMINAL_PANEL = {
  id: "terminal-1",
  title: "Terminal 1",
  params: {
    kind: "terminal",
    workspaceId: "w1",
    sessionId: "wb-term-1",
    title: "Terminal 1",
  },
};
const FILE_PANEL = {
  id: "file-1",
  title: "workbench-dockview.tsx",
  params: {
    kind: "file",
    workspaceId: "w1",
    path: "components/workbench/workbench-dockview.tsx",
  },
};

afterEach(() => {
  cleanup();
});

describe("WorkbenchTabSwitcher", () => {
  it("counts every open tab, not just the ones off screen", () => {
    // Given three open tabs
    render(
      <WorkbenchTabSwitcher
        panels={[CHAT_PANEL, TERMINAL_PANEL, FILE_PANEL]}
        activePanelId="terminal-1"
        onSelectPanel={vi.fn()}
      />,
    );

    // Then the trigger shows the total
    expect(
      screen.getByRole("button", { name: "Switch tab, 3 open" }),
    ).toHaveTextContent("3");
  });

  it("lists every tab with the active one checked", async () => {
    // Given three open tabs with the terminal active
    const user = userEvent.setup();
    render(
      <WorkbenchTabSwitcher
        panels={[CHAT_PANEL, TERMINAL_PANEL, FILE_PANEL]}
        activePanelId="terminal-1"
        onSelectPanel={vi.fn()}
      />,
    );

    // When the switcher opens
    await user.click(
      screen.getByRole("button", { name: "Switch tab, 3 open" }),
    );

    // Then all three tabs are listed in tab order, the terminal checked
    const tabItems = screen.getAllByRole("menuitemradio");
    expect(tabItems.map((item) => item.textContent)).toEqual([
      "Fix mobile tabs",
      "Terminal 1",
      "workbench-dockview.tsx",
    ]);
    expect(
      screen.getByRole("menuitemradio", { name: "Terminal 1" }),
    ).toHaveAttribute("aria-checked", "true");
  });

  it("selects the chosen tab", async () => {
    // Given the switcher is open
    const user = userEvent.setup();
    const onSelectPanel = vi.fn();
    render(
      <WorkbenchTabSwitcher
        panels={[CHAT_PANEL, TERMINAL_PANEL]}
        activePanelId="terminal-1"
        onSelectPanel={onSelectPanel}
      />,
    );
    await user.click(
      screen.getByRole("button", { name: "Switch tab, 2 open" }),
    );

    // When the user picks the chat
    await user.click(
      screen.getByRole("menuitemradio", { name: "Fix mobile tabs" }),
    );

    // Then that tab is selected
    expect(onSelectPanel).toHaveBeenCalledWith("chat-1");
  });

  it("stays hidden while there is only one tab", () => {
    // Given a single open tab
    render(
      <WorkbenchTabSwitcher
        panels={[CHAT_PANEL]}
        activePanelId="chat-1"
        onSelectPanel={vi.fn()}
      />,
    );

    // Then there is nothing to switch to
    expect(
      screen.queryByRole("button", { name: /^Switch tab/ }),
    ).not.toBeInTheDocument();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NewChatMenu } from "@/components/chat/new-chat-menu";
import { Button } from "@/components/ui/button";
import type { ChatEngine } from "@/lib/engine/types";

HTMLElement.prototype.scrollIntoView = vi.fn();
HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
HTMLElement.prototype.releasePointerCapture = vi.fn();

class MockPointerEvent extends Event {
  button: number;
  ctrlKey: boolean;
  pointerType: string;

  constructor(type: string, props: PointerEventInit) {
    super(type, props);
    this.button = props.button || 0;
    this.ctrlKey = props.ctrlKey || false;
    this.pointerType = props.pointerType || "mouse";
  }
}
window.PointerEvent = MockPointerEvent as unknown as typeof PointerEvent;

interface WorkspaceEngineResult {
  engine: ChatEngine;
  isLoading: boolean;
}

const useWorkspaceEngineMock = vi.hoisted(() =>
  vi.fn<(workspaceId: string | null) => WorkspaceEngineResult>(),
);
vi.mock("@/hooks/use-workspace-engine", () => ({
  useWorkspaceEngine: useWorkspaceEngineMock,
}));

const WORKSPACE_ID = "ws-1";

function renderNewChatMenu() {
  const onCreate = vi.fn<(engine: ChatEngine) => void>();
  render(
    <NewChatMenu workspaceId={WORKSPACE_ID} onCreate={onCreate}>
      <Button size="icon-xs" variant="ghost" aria-label="New chat">
        +
      </Button>
    </NewChatMenu>,
  );
  return onCreate;
}

async function openMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "New chat" }));
  return screen.findByRole("menu");
}

beforeEach(() => {
  useWorkspaceEngineMock.mockReset();
  useWorkspaceEngineMock.mockReturnValue({
    engine: "opencode",
    isLoading: false,
  });
});

describe("NewChatMenu", () => {
  it("opens a New chat menu and only looks up the default engine once open", async () => {
    const user = userEvent.setup();
    renderNewChatMenu();
    expect(useWorkspaceEngineMock).not.toHaveBeenCalled();

    const menu = await openMenu(user);

    expect(menu).toBeInTheDocument();
    expect(screen.getByText("New chat")).toBeInTheDocument();
    expect(useWorkspaceEngineMock).toHaveBeenCalledWith(WORKSPACE_ID);
  });

  it("lists OpenCode first, then OMO Native", async () => {
    const user = userEvent.setup();
    renderNewChatMenu();

    await openMenu(user);

    const items = screen.getAllByRole("menuitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveAccessibleName("OpenCode");
    expect(items[1]).toHaveAccessibleName("OMO Native");
  });

  it("marks the workspace's default engine", async () => {
    useWorkspaceEngineMock.mockReturnValue({ engine: "omo", isLoading: false });
    const user = userEvent.setup();
    renderNewChatMenu();

    await openMenu(user);

    expect(
      screen.getByRole("menuitem", { name: "OMO Native" }),
    ).toHaveAccessibleDescription("Default");
    expect(
      screen.getByRole("menuitem", { name: "OpenCode" }),
    ).not.toHaveAccessibleDescription();
    expect(screen.getAllByText("Default")).toHaveLength(1);
  });

  it("marks no default while the default engine is loading", async () => {
    useWorkspaceEngineMock.mockReturnValue({
      engine: "opencode",
      isLoading: true,
    });
    const user = userEvent.setup();
    renderNewChatMenu();

    await openMenu(user);

    expect(screen.getAllByRole("menuitem")).toHaveLength(2);
    expect(screen.queryByText("Default")).not.toBeInTheDocument();
  });

  it("creates an OMO Native chat once and closes when OMO Native is picked", async () => {
    const user = userEvent.setup();
    const onCreate = renderNewChatMenu();

    await openMenu(user);
    await user.click(screen.getByRole("menuitem", { name: "OMO Native" }));

    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(onCreate).toHaveBeenCalledWith("omo");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("creates an OpenCode chat from the keyboard", async () => {
    const user = userEvent.setup();
    const onCreate = renderNewChatMenu();

    await user.tab();
    await user.keyboard("{Enter}");
    const openCodeItem = await screen.findByRole("menuitem", {
      name: "OpenCode",
    });
    await waitFor(() => expect(openCodeItem).toHaveFocus());
    await user.keyboard("{Enter}");

    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(onCreate).toHaveBeenCalledWith("opencode");
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const engineState = vi.hoisted(() => ({
  value: { engine: "opencode", isLoading: false },
}));
vi.mock("@/hooks/use-workspace-engine", () => ({
  useWorkspaceEngine: () => engineState.value,
}));

import { EmptyChat } from "@/components/chat/empty-chat";
import { useChatStore } from "@/stores/chat-store";
import {
  getNewChatEngineChoice,
  useNewChatEngineStore,
} from "@/stores/new-chat-engine-store";

const WORKSPACE_ID = "ws-1";
const initialChatState = useChatStore.getInitialState();
const initialNewChatEngineState = useNewChatEngineStore.getInitialState();

beforeEach(() => {
  engineState.value = { engine: "opencode", isLoading: false };
  useChatStore.setState(initialChatState, true);
  useNewChatEngineStore.setState(initialNewChatEngineState, true);
});

function activateWorkspace(activeSessionId: string | null) {
  useChatStore.setState({ activeWorkspaceId: WORKSPACE_ID, activeSessionId });
}

describe("EmptyChat", () => {
  it("names OpenCode for OpenCode workspaces", () => {
    engineState.value = { engine: "opencode", isLoading: false };
    render(<EmptyChat onSend={vi.fn()} />);
    expect(
      screen.getByText("Ask OpenCode anything about your project"),
    ).toBeInTheDocument();
  });

  it("names OmO for omo workspaces", () => {
    engineState.value = { engine: "omo", isLoading: false };
    render(<EmptyChat onSend={vi.fn()} />);
    expect(
      screen.getByText("Ask OmO anything about your project"),
    ).toBeInTheDocument();
  });
});

describe("EmptyChat engine toggle", () => {
  it("offers both engines, defaulting to the workspace engine, when no session is active", () => {
    activateWorkspace(null);
    render(<EmptyChat onSend={vi.fn()} />);

    const toggle = within(screen.getByRole("group", { name: "Chat engine" }));
    expect(toggle.getAllByRole("button")).toHaveLength(2);
    expect(toggle.getByRole("button", { name: "OpenCode" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(toggle.getByRole("button", { name: "OMO Native" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("stores OMO Native for the workspace and names OmO in the prompt line", async () => {
    activateWorkspace(null);
    const user = userEvent.setup();
    render(<EmptyChat onSend={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "OMO Native" }));

    expect(getNewChatEngineChoice(WORKSPACE_ID)).toBe("omo");
    expect(screen.getByRole("button", { name: "OMO Native" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "OpenCode" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(
      screen.getByText("Ask OmO anything about your project"),
    ).toBeInTheDocument();
  });

  it("hides the toggle when a session is active", () => {
    activateWorkspace("ses_1");
    render(<EmptyChat onSend={vi.fn()} />);

    expect(
      screen.queryByRole("group", { name: "Chat engine" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("Ask OpenCode anything about your project"),
    ).toBeInTheDocument();
  });

  it("hides the toggle while the workspace engine is loading", () => {
    engineState.value = { engine: "opencode", isLoading: true };
    activateWorkspace(null);
    render(<EmptyChat onSend={vi.fn()} />);

    expect(
      screen.queryByRole("group", { name: "Chat engine" }),
    ).not.toBeInTheDocument();
  });

  it("hides the toggle without an active workspace", () => {
    render(<EmptyChat onSend={vi.fn()} />);

    expect(
      screen.queryByRole("group", { name: "Chat engine" }),
    ).not.toBeInTheDocument();
  });
});

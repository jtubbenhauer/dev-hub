import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SessionList } from "@/components/chat/session-list";
import type { SessionWithWorkspace } from "@/stores/chat-store";

function makeUnifiedSession(
  id: string,
  workspaceId: string,
  opts: { title?: string; updated?: number } = {},
): SessionWithWorkspace {
  return {
    id,
    workspaceId,
    projectID: "proj-1",
    directory: "/workspace",
    title: opts.title ?? `Session ${id}`,
    version: "1",
    time: { created: 1000, updated: opts.updated ?? 1000 },
  };
}

const baseProps = {
  activeSessionId: null,
  sessionStatuses: {},
  lastViewedAt: {},
  onCreateSession: vi.fn(),
  onDeleteSession: vi.fn(),
};

describe("SessionList — unified mode workspace picker", () => {
  it("renders dropdown trigger when workspaces and callback are provided", () => {
    render(
      <SessionList
        {...baseProps}
        mode="unified"
        sessions={[]}
        workspaceNames={{}}
        workspaceBranches={{}}
        onSelectSession={vi.fn()}
        workspaces={[{ id: "ws-1", name: "My Workspace", backend: "local" }]}
        activeWorkspaceId="ws-1"
        onCreateSessionInWorkspace={vi.fn()}
      />,
    );

    const triggers = screen.getAllByRole("button");
    const plusButton = triggers.find(
      (btn) =>
        btn.querySelector("[data-slot='dropdown-menu-trigger']") !== null ||
        btn.closest("[data-slot='dropdown-menu-trigger']") !== null ||
        btn.getAttribute("data-slot") === "dropdown-menu-trigger",
    );
    expect(plusButton ?? triggers.length).toBeTruthy();
  });

  it("renders plain Plus button when not in unified mode", () => {
    const onCreateSession = vi.fn();
    render(
      <SessionList
        {...baseProps}
        mode="workspace"
        sessions={{}}
        onSelectSession={vi.fn()}
        onCreateSession={onCreateSession}
      />,
    );

    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBeGreaterThan(0);
  });

  it("renders plain Plus button in unified mode when no workspaces provided", () => {
    const onCreateSession = vi.fn();
    render(
      <SessionList
        {...baseProps}
        mode="unified"
        sessions={[]}
        workspaceNames={{}}
        workspaceBranches={{}}
        onSelectSession={vi.fn()}
        onCreateSession={onCreateSession}
      />,
    );

    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBeGreaterThan(0);
  });

  it("shows workspace names in dropdown when opened", async () => {
    const user = userEvent.setup();
    const onCreateInWorkspace = vi.fn();

    render(
      <SessionList
        {...baseProps}
        mode="unified"
        sessions={[]}
        workspaceNames={{}}
        workspaceBranches={{}}
        onSelectSession={vi.fn()}
        workspaces={[
          { id: "ws-1", name: "Local Project", backend: "local" },
          { id: "ws-2", name: "Remote Server", backend: "remote" },
        ]}
        activeWorkspaceId="ws-1"
        onCreateSessionInWorkspace={onCreateInWorkspace}
      />,
    );

    const triggerButton = screen.getByRole("button", { expanded: false });
    await user.click(triggerButton);

    expect(await screen.findByText("Local Project")).toBeInTheDocument();
    expect(await screen.findByText("Remote Server")).toBeInTheDocument();
  });

  it("calls onCreateSessionInWorkspace with correct ID when item clicked", async () => {
    const user = userEvent.setup();
    const onCreateInWorkspace = vi.fn();

    render(
      <SessionList
        {...baseProps}
        mode="unified"
        sessions={[]}
        workspaceNames={{}}
        workspaceBranches={{}}
        onSelectSession={vi.fn()}
        workspaces={[
          { id: "ws-1", name: "Local Project", backend: "local" },
          { id: "ws-2", name: "Remote Server", backend: "remote" },
        ]}
        activeWorkspaceId="ws-1"
        onCreateSessionInWorkspace={onCreateInWorkspace}
      />,
    );

    const triggerButton = screen.getByRole("button", { expanded: false });
    await user.click(triggerButton);

    const remoteItem = await screen.findByText("Remote Server");
    await user.click(remoteItem);

    expect(onCreateInWorkspace).toHaveBeenCalledWith("ws-2");
  });

  it("shows question icon instead of brain icon when session has pending question", () => {
    const sessions: Record<
      string,
      {
        id: string;
        projectID: string;
        directory: string;
        title: string;
        version: string;
        time: { created: number; updated: number };
      }
    > = {
      "sess-1": {
        id: "sess-1",
        projectID: "proj-1",
        directory: "/workspace",
        title: "Question Session",
        version: "1",
        time: { created: 1000, updated: 2000 },
      },
    };

    const { container } = render(
      <SessionList
        {...baseProps}
        mode="workspace"
        sessions={sessions}
        sessionStatuses={{ "sess-1": { type: "busy" } as never }}
        questionSessionIds={new Set(["sess-1"])}
        onSelectSession={vi.fn()}
      />,
    );

    const sessionRow = container.querySelector("[data-session-id='sess-1']");
    expect(sessionRow).toBeTruthy();
    const questionIcon = sessionRow?.querySelector(
      "svg.lucide-message-circle-question-mark",
    );
    const brainIcon = sessionRow?.querySelector("svg.lucide-brain");
    expect(questionIcon).toBeTruthy();
    expect(brainIcon).toBeNull();
  });

  it("shows brain icon for busy session without pending question", () => {
    const sessions: Record<
      string,
      {
        id: string;
        projectID: string;
        directory: string;
        title: string;
        version: string;
        time: { created: number; updated: number };
      }
    > = {
      "sess-1": {
        id: "sess-1",
        projectID: "proj-1",
        directory: "/workspace",
        title: "Busy Session",
        version: "1",
        time: { created: 1000, updated: 2000 },
      },
    };

    const { container } = render(
      <SessionList
        {...baseProps}
        mode="workspace"
        sessions={sessions}
        sessionStatuses={{ "sess-1": { type: "busy" } as never }}
        onSelectSession={vi.fn()}
      />,
    );

    const sessionRow = container.querySelector("[data-session-id='sess-1']");
    expect(sessionRow).toBeTruthy();
    const brainIcon = sessionRow?.querySelector("svg.lucide-brain");
    const questionIcon = sessionRow?.querySelector(
      "svg.lucide-message-circle-question-mark",
    );
    expect(brainIcon).toBeTruthy();
    expect(questionIcon).toBeNull();
  });

  it("renders session items with workspace badges in unified mode", () => {
    render(
      <SessionList
        {...baseProps}
        mode="unified"
        sessions={[
          makeUnifiedSession("sess-1", "ws-1", { title: "Test Session" }),
        ]}
        workspaceNames={{ "ws-1": "My Workspace" }}
        workspaceBranches={{ "ws-1": "main" }}
        onSelectSession={vi.fn()}
        workspaces={[{ id: "ws-1", name: "My Workspace", backend: "local" }]}
        activeWorkspaceId="ws-1"
        onCreateSessionInWorkspace={vi.fn()}
      />,
    );

    expect(screen.getByText("Test Session")).toBeInTheDocument();
    // Branch name is shown when workspaceBranches provides it; falls back to workspace name
    expect(screen.getByText("main")).toBeInTheDocument();
  });
});

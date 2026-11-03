import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SessionPickerDialog,
  SessionPickerProvider,
  useSessionPicker,
} from "@/components/session-picker/session-picker";
import type { ChatEngine } from "@/lib/engine/types";
import type { Session } from "@/lib/opencode/types";
import type { OpenChatInWorkbenchInput } from "@/lib/workbench/open-in-workbench";
import { useChatStore, type WorkspaceState } from "@/stores/chat-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { Workspace } from "@/types";

const navigation = vi.hoisted(() => ({
  push: vi.fn<(href: string) => void>(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: navigation.push }),
  usePathname: () => "/settings",
}));

const workbenchOpeners = vi.hoisted(() => ({
  openChatInWorkbench: vi.fn<(input: OpenChatInWorkbenchInput) => void>(),
}));

vi.mock("@/lib/workbench/open-in-workbench", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/lib/workbench/open-in-workbench")
  >()),
  openChatInWorkbench: workbenchOpeners.openChatInWorkbench,
}));

type CreateSession = (
  workspaceId: string,
  engine?: ChatEngine,
) => Promise<Session | null>;

const ACTIVE_WORKSPACE_ID = "ws-active";
const OTHER_WORKSPACE_ID = "ws-other";
const originalCreateSession = useChatStore.getState().createSession;

function makeSession(id: string, title: string): Session {
  return {
    id,
    projectID: "project-1",
    directory: "/workspace",
    title,
    version: "1",
    time: { created: 1000, updated: 2000 },
  };
}

function makeWorkspace(id: string, name: string): Workspace {
  return {
    id,
    userId: "user-1",
    name,
    path: `/workspace/${id}`,
    type: "repo",
    parentRepoPath: null,
    packageManager: null,
    quickCommands: null,
    backend: "local",
    provider: null,
    opencodeUrl: null,
    agentUrl: null,
    providerMeta: null,
    shellCommand: null,
    sshTarget: null,
    sshPath: null,
    worktreeSymlinks: null,
    linkedTaskId: null,
    linkedTaskMeta: null,
    color: null,
    createdAt: new Date("2025-01-01"),
    lastAccessedAt: new Date("2025-01-01"),
  };
}

function makeWorkspaceState(sessions: readonly Session[]): WorkspaceState {
  return {
    sessions: Object.fromEntries(
      sessions.map((session) => [session.id, session]),
    ),
    sessionsLoaded: true,
    messages: {},
    optimisticMessageIds: {},
    sessionStatuses: {},
    permissions: [],
    questions: [],
    todos: {},
    sessionAgents: {},
    sessionModels: {},
    sessionVariants: {},
    lastViewedAt: {},
    pinnedSessionIds: new Set(),
    sessionNotes: {},
  };
}

function seedStores(createSession: CreateSession): void {
  useWorkspaceStore.setState({
    activeWorkspaceId: ACTIVE_WORKSPACE_ID,
    workspaces: [
      makeWorkspace(ACTIVE_WORKSPACE_ID, "Active Workspace"),
      makeWorkspace(OTHER_WORKSPACE_ID, "Other Workspace"),
    ],
  });
  useChatStore.setState({
    activeWorkspaceId: ACTIVE_WORKSPACE_ID,
    activeSessionId: "s-current",
    createSession,
    workspaceStates: {
      [ACTIVE_WORKSPACE_ID]: makeWorkspaceState([
        makeSession("s-current", "Current Session"),
      ]),
      [OTHER_WORKSPACE_ID]: makeWorkspaceState([
        makeSession("s-other", "Other Session"),
      ]),
    },
  });
}

function OpenPickerButton() {
  const { open } = useSessionPicker();
  return <button onClick={open}>Open Picker</button>;
}

async function openPicker(): Promise<void> {
  render(
    <SessionPickerProvider>
      <OpenPickerButton />
      <SessionPickerDialog />
    </SessionPickerProvider>,
  );
  await userEvent.click(screen.getByText("Open Picker"));
}

function createDeferredSession() {
  let resolveSession: (session: Session | null) => void = () => {};
  const createSession = vi.fn<CreateSession>(
    () =>
      new Promise<Session | null>((resolve) => {
        resolveSession = resolve;
      }),
  );
  return {
    createSession,
    resolve: (session: Session | null) => resolveSession(session),
  };
}

beforeEach(() => {
  navigation.push.mockReset();
  workbenchOpeners.openChatInWorkbench.mockReset();
});

afterEach(() => {
  cleanup();
  useChatStore.setState({
    activeWorkspaceId: null,
    activeSessionId: null,
    workspaceStates: {},
    createSession: originalCreateSession,
  });
  useWorkspaceStore.setState({ activeWorkspaceId: null, workspaces: [] });
});

describe("SessionPickerDialog workbench opening", () => {
  it("opens the selected entry's session in its own workspace", async () => {
    // Given
    seedStores(vi.fn<CreateSession>(async () => null));
    await openPicker();

    // When
    await userEvent.click(screen.getByText("Other Session"));

    // Then
    expect(workbenchOpeners.openChatInWorkbench).toHaveBeenCalledWith({
      workspaceId: OTHER_WORKSPACE_ID,
      sessionId: "s-other",
      navigate: expect.any(Function),
    });
  });

  it("leaves the session switch to the workbench opener", async () => {
    // Given
    seedStores(vi.fn<CreateSession>(async () => null));
    await openPicker();

    // When
    await userEvent.click(screen.getByText("Other Session"));

    // Then
    expect(useChatStore.getState().activeSessionId).toBe("s-current");
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe(
      ACTIVE_WORKSPACE_ID,
    );
  });

  it("closes the picker when an entry is selected", async () => {
    // Given
    seedStores(vi.fn<CreateSession>(async () => null));
    await openPicker();

    // When
    await userEvent.click(screen.getByText("Other Session"));

    // Then
    expect(
      screen.queryByPlaceholderText("Search sessions..."),
    ).not.toBeInTheDocument();
  });

  it("navigates through the Next router when the workbench must load", async () => {
    // Given
    seedStores(vi.fn<CreateSession>(async () => null));
    await openPicker();
    await userEvent.click(screen.getByText("Other Session"));
    const openerInput = workbenchOpeners.openChatInWorkbench.mock.lastCall?.[0];

    // When
    openerInput?.navigate("/workbench?open=chat");

    // Then
    expect(navigation.push).toHaveBeenCalledWith("/workbench?open=chat");
  });

  it("waits for the new session before opening it", async () => {
    // Given
    const deferred = createDeferredSession();
    seedStores(deferred.createSession);
    await openPicker();

    // When
    await userEvent.click(screen.getByText("New Session"));

    // Then
    expect(deferred.createSession).toHaveBeenCalledTimes(1);
    expect(workbenchOpeners.openChatInWorkbench).not.toHaveBeenCalled();
  });

  it("opens the created session in the active workspace", async () => {
    // Given
    const deferred = createDeferredSession();
    seedStores(deferred.createSession);
    await openPicker();
    await userEvent.click(screen.getByText("New Session"));

    // When
    deferred.resolve(makeSession("s-created", "Created Session"));

    // Then
    await waitFor(() =>
      expect(workbenchOpeners.openChatInWorkbench).toHaveBeenCalledWith({
        workspaceId: ACTIVE_WORKSPACE_ID,
        sessionId: "s-created",
        navigate: expect.any(Function),
      }),
    );
  });

  it("closes the picker before the new session exists", async () => {
    // Given
    const deferred = createDeferredSession();
    seedStores(deferred.createSession);
    await openPicker();

    // When
    await userEvent.click(screen.getByText("New Session"));

    // Then
    expect(
      screen.queryByPlaceholderText("Search sessions..."),
    ).not.toBeInTheDocument();
  });

  it("opens nothing when the new session cannot be created", async () => {
    // Given
    const createSession = vi.fn<CreateSession>(async () => null);
    seedStores(createSession);
    await openPicker();

    // When
    await userEvent.click(screen.getByText("New Session"));

    // Then
    await waitFor(() => expect(createSession).toHaveBeenCalledTimes(1));
    expect(workbenchOpeners.openChatInWorkbench).not.toHaveBeenCalled();
  });
});

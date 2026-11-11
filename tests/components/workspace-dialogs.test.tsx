import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  AddWorkspaceButton,
  AddWorkspaceDialog,
} from "@/components/workspace/add-workspace-dialog";
import {
  CloneRepoButton,
  CloneRepoDialog,
} from "@/components/workspace/clone-repo-dialog";
import {
  ConnectRemoteButton,
  ConnectRemoteDialog,
} from "@/components/workspace/connect-remote-dialog";
import {
  useWorkspaceDialogStore,
  type WorkspaceDialog,
} from "@/stores/workspace-dialog-store";

// The real browser lists the server's directories; picking one is all a
// test needs.
vi.mock("@/components/workspace/directory-browser", () => ({
  DirectoryBrowser: ({ onSelect }: { onSelect: (path: string) => void }) => (
    <button type="button" onClick={() => onSelect("/code/demo")}>
      Pick /code/demo
    </button>
  ),
}));

function renderWithQueryClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

function openDialog(dialog: WorkspaceDialog) {
  act(() => useWorkspaceDialogStore.getState().open(dialog));
}

afterEach(() => {
  act(() => useWorkspaceDialogStore.getState().close());
  vi.unstubAllGlobals();
});

describe("workspace dialogs", () => {
  it.each([
    {
      kind: "clone-repo",
      dialog: <CloneRepoDialog />,
      title: "Clone Repository",
    },
    {
      kind: "connect-remote",
      dialog: <ConnectRemoteDialog />,
      title: "Connect Remote Workspace",
    },
    {
      kind: "add-workspace",
      dialog: <AddWorkspaceDialog />,
      title: "Browse for Directory",
    },
  ] as const)(
    "opens the $kind dialog when the store asks for it",
    ({ kind, dialog, title }) => {
      // Given
      renderWithQueryClient(dialog);

      // When
      openDialog({ kind });

      // Then
      expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
    },
  );

  it.each([
    {
      button: <CloneRepoButton />,
      name: "Clone Repo",
      kind: "clone-repo",
    },
    {
      button: <ConnectRemoteButton />,
      name: "Connect Remote",
      kind: "connect-remote",
    },
    {
      button: <AddWorkspaceButton />,
      name: "Add Workspace",
      kind: "add-workspace",
    },
  ] as const)(
    "opens the $kind dialog from its page button",
    async ({ button, name, kind }) => {
      // Given
      const user = userEvent.setup();
      renderWithQueryClient(button);

      // When
      await user.click(screen.getByRole("button", { name }));

      // Then
      expect(useWorkspaceDialogStore.getState().openDialog).toEqual({ kind });
    },
  );

  it("forgets the typed clone URL once closed", async () => {
    // Given
    const user = userEvent.setup();
    renderWithQueryClient(<CloneRepoDialog />);
    openDialog({ kind: "clone-repo" });
    await user.type(
      screen.getByLabelText("Repository URL"),
      "https://github.com/acme/demo",
    );
    await user.keyboard("{Escape}");

    // When
    openDialog({ kind: "clone-repo" });

    // Then
    expect(screen.getByLabelText("Repository URL")).toHaveValue("");
  });

  it("adds the picked directory as a workspace and closes", async () => {
    // Given
    const fetchMock = vi.fn(async () =>
      Response.json({ id: "ws-demo", name: "demo" }, { status: 201 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderWithQueryClient(<AddWorkspaceDialog />);
    openDialog({ kind: "add-workspace" });
    await user.click(screen.getByRole("button", { name: "Pick /code/demo" }));

    // When
    await user.click(screen.getByRole("button", { name: "Add Workspace" }));

    // Then
    await waitFor(() =>
      expect(useWorkspaceDialogStore.getState().openDialog).toBeNull(),
    );
    expect(fetchMock).toHaveBeenCalledWith("/api/workspaces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "demo", path: "/code/demo" }),
    });
  });
});

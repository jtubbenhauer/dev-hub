import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CommandPalette } from "@/components/command-palette/command-palette";
import {
  CommandPaletteProvider,
  type PaletteCommand,
} from "@/components/providers/command-palette-provider";
import { LeaderKeyProvider } from "@/components/providers/leader-key-provider";
import { useCommand } from "@/hooks/use-command";
import { useLeaderAction } from "@/hooks/use-leader-action";
import { useRecentPaletteCommandsStore } from "@/stores/recent-palette-commands-store";
import type { LeaderBindingsMap } from "@/types/leader-key";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
}));

const splitRight = vi.fn();
const focusGroupDown = vi.fn();
const createWorktree = vi.fn();
const cloneRepo = vi.fn();
const focusTab = vi.fn<(tabNumber: number) => void>();

const TAB_NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

const leaderActions = [
  {
    action: {
      id: "workbench:split-right",
      label: "Split right",
      page: "workbench",
    },
    handler: splitRight,
  },
  {
    action: {
      id: "workbench:focus-group-down",
      label: "Focus group below",
      page: "workbench",
    },
    handler: focusGroupDown,
  },
  ...TAB_NUMBERS.map((tabNumber) => ({
    action: {
      id: `workbench:focus-tab-${tabNumber}`,
      label: tabNumber === 9 ? "Go to last tab" : `Go to tab ${tabNumber}`,
      page: "workbench",
    },
    handler: () => focusTab(tabNumber),
  })),
];

const bindings: LeaderBindingsMap = {
  "workbench:split-right": "|",
  ...Object.fromEntries(
    TAB_NUMBERS.map((tabNumber) => [
      `workbench:focus-tab-${tabNumber}`,
      String(tabNumber),
    ]),
  ),
};

function moveFocusToOther() {
  document.getElementById("other")?.focus();
}

const paletteCommands: PaletteCommand[] = [
  {
    id: "workspace:create-worktree",
    label: "Create worktree",
    group: "Workspaces",
    keywords: ["add worktree"],
    onSelect: createWorktree,
  },
  {
    id: "workspace:clone-repo",
    label: "Clone repo",
    group: "Workspaces",
    onSelect: cloneRepo,
  },
  {
    id: "test:focus-other",
    label: "Focus the other field",
    group: "Test",
    onSelect: moveFocusToOther,
  },
  {
    id: "quick-command:ws-1:pnpm dev",
    label: "Dev server",
    group: "Run",
    detail: "pnpm dev",
    onSelect: vi.fn(),
  },
];

function Registrations() {
  useLeaderAction(leaderActions);
  useCommand(paletteCommands);
  return null;
}

function renderPalette() {
  render(
    <CommandPaletteProvider>
      <LeaderKeyProvider bindings={bindings}>
        <Registrations />
        <input aria-label="prompt" />
        <input aria-label="other" id="other" />
        <CommandPalette />
      </LeaderKeyProvider>
    </CommandPaletteProvider>,
  );
}

async function openPalette(user: ReturnType<typeof userEvent.setup>) {
  await user.keyboard("{Meta>}{Shift>}P{/Shift}{/Meta}");
  await screen.findByRole("dialog");
}

// Lets the dialog's deferred close work (focus restore) run.
async function flushTimers() {
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
}

beforeEach(() => {
  vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
  localStorage.clear();
  useRecentPaletteCommandsStore.setState({ recentCommandIds: [] });
  splitRight.mockClear();
  focusGroupDown.mockClear();
  createWorktree.mockClear();
  cloneRepo.mockClear();
  focusTab.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("CommandPalette", () => {
  it("lists a registered leader action with its leader keys", async () => {
    // Given
    const user = userEvent.setup();
    renderPalette();

    // When
    await openPalette(user);

    // Then
    const option = screen.getByRole("option", { name: /Split right/ });
    expect(option).toHaveTextContent("⌃Space|");
  });

  it("runs the picked leader action and closes the palette", async () => {
    // Given
    const user = userEvent.setup();
    renderPalette();
    await openPalette(user);

    // When
    await user.click(screen.getByRole("option", { name: /Split right/ }));

    // Then
    await waitFor(() => expect(splitRight).toHaveBeenCalledOnce());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("finds a command by one of its keywords and runs it on Enter", async () => {
    // Given
    const user = userEvent.setup();
    renderPalette();
    await openPalette(user);

    // When
    await user.keyboard("add worktree{Enter}");

    // Then
    await waitFor(() => expect(createWorktree).toHaveBeenCalledOnce());
  });

  it("runs the best match on Enter even when a weaker match's group comes first", async () => {
    // Given
    const user = userEvent.setup();
    renderPalette();
    await openPalette(user);

    // When
    await user.keyboard("clone repo{Enter}");

    // Then
    await waitFor(() => expect(cloneRepo).toHaveBeenCalledOnce());
    expect(focusGroupDown).not.toHaveBeenCalled();
  });

  it("puts focus back where it was when closed without running a command", async () => {
    // Given
    const user = userEvent.setup();
    renderPalette();
    const prompt = screen.getByRole("textbox", { name: "prompt" });
    prompt.focus();
    await openPalette(user);

    // When
    await user.keyboard("{Escape}");

    // Then
    await waitFor(() => expect(prompt).toHaveFocus());
  });

  it("leaves focus where the picked command moved it", async () => {
    // Given
    const user = userEvent.setup();
    renderPalette();
    screen.getByRole("textbox", { name: "prompt" }).focus();
    await openPalette(user);

    // When
    await user.keyboard("focus the other{Enter}");
    await flushTimers();

    // Then
    expect(screen.getByRole("textbox", { name: "other" })).toHaveFocus();
  });

  it("shows the nine tab actions as one Go to tab line", async () => {
    // Given
    const user = userEvent.setup();
    renderPalette();

    // When
    await openPalette(user);

    // Then
    const tabOptions = screen.getAllByRole("option", { name: /Go to/ });
    expect(tabOptions).toHaveLength(1);
    expect(tabOptions[0]).toHaveTextContent("Go to tab 1–9⌃Space1–9");
  });

  it("goes to the tab number typed after it", async () => {
    // Given
    const user = userEvent.setup();
    renderPalette();
    await openPalette(user);

    // When
    await user.keyboard("tab 2{Enter}");

    // Then
    await waitFor(() => expect(focusTab).toHaveBeenCalledExactlyOnceWith(2));
  });

  it("asks for a tab number when Go to tab is picked without one", async () => {
    // Given
    const user = userEvent.setup();
    renderPalette();
    await openPalette(user);

    // When
    await user.keyboard("go to tab{Enter}");

    // Then
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("combobox")).toHaveValue("tab ");
    expect(focusTab).not.toHaveBeenCalled();
  });

  it("pins the command run last in a Recent group on top", async () => {
    // Given
    const user = userEvent.setup();
    renderPalette();
    await openPalette(user);
    await user.click(screen.getByRole("option", { name: /Split right/ }));
    await waitFor(() => expect(splitRight).toHaveBeenCalledOnce());

    // When
    await openPalette(user);

    // Then
    const firstGroup = screen.getAllByRole("group")[0];
    expect(firstGroup).toHaveAccessibleName("Recent");
    expect(
      within(firstGroup).getByRole("option", { name: /Split right/ }),
    ).toBeInTheDocument();
  });

  it("shows a command's detail next to its label", async () => {
    // Given
    const user = userEvent.setup();
    renderPalette();

    // When
    await openPalette(user);

    // Then
    expect(
      screen.getByRole("option", { name: /Dev server/ }),
    ).toHaveTextContent("Dev serverpnpm dev");
  });
});

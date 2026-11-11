import { describe, expect, it, vi } from "vitest";
import {
  buildPaletteEntries,
  groupPaletteEntries,
  rankPaletteGroups,
  type PaletteEntry,
} from "@/components/command-palette/palette-entries";
import type { PaletteCommand } from "@/components/providers/command-palette-provider";
import type { LeaderAction, LeaderBindingsMap } from "@/types/leader-key";

const TAB_NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

const tabBindings: LeaderBindingsMap = Object.fromEntries(
  TAB_NUMBERS.map((tabNumber) => [
    `workbench:focus-tab-${tabNumber}`,
    String(tabNumber),
  ]),
);

const bindings: LeaderBindingsMap = {
  ...tabBindings,
  "workbench:new-chat": "o c",
  "workbench:split-right": "|",
  "global:command-palette": ",",
  "global:file-picker": "f",
};

function leaderAction(id: string, label: string): LeaderAction {
  return { id, label, page: "global" };
}

const tabActions = TAB_NUMBERS.map((tabNumber) =>
  leaderAction(
    `workbench:focus-tab-${tabNumber}`,
    tabNumber === 9 ? "Go to last tab" : `Go to tab ${tabNumber}`,
  ),
);

function paletteCommand(id: string, label: string, group: string) {
  return {
    id,
    label,
    group,
    onSelect: vi.fn(),
  } satisfies PaletteCommand;
}

type BuildInput = Parameters<typeof buildPaletteEntries>[0];

function build(overrides: Partial<BuildInput> = {}): PaletteEntry[] {
  return buildPaletteEntries({
    commands: [],
    leaderActions: [],
    bindings,
    runLeaderAction: vi.fn(),
    search: "",
    promptForTabNumber: vi.fn(),
    ...overrides,
  });
}

function entryById(entries: PaletteEntry[], id: string): PaletteEntry {
  const entry = entries.find((candidate) => candidate.id === id);
  if (!entry) throw new Error(`${id} is not in the palette`);
  return entry;
}

describe("buildPaletteEntries", () => {
  it("runs a registered leader action through the leader registry", () => {
    // Given
    const runLeaderAction = vi.fn();
    const entries = build({
      leaderActions: [leaderAction("workbench:split-right", "Split right")],
      runLeaderAction,
    });

    // When
    entryById(entries, "workbench:split-right").onSelect();

    // Then
    expect(runLeaderAction).toHaveBeenCalledExactlyOnceWith(
      "workbench:split-right",
    );
  });

  it("shows the leader keys of a registered leader action", () => {
    // When
    const entries = build({
      leaderActions: [leaderAction("workbench:new-chat", "New chat")],
    });

    // Then
    expect(entryById(entries, "workbench:new-chat").leaderKeys).toEqual([
      "o",
      "c",
    ]);
  });

  it("keeps the palette command over a leader action with the same id and shows its leader keys", () => {
    // Given
    const command = paletteCommand("workbench:new-chat", "New chat", "Create");
    const runLeaderAction = vi.fn();

    // When
    const entries = build({
      commands: [command],
      leaderActions: [leaderAction("workbench:new-chat", "New chat (leader)")],
      runLeaderAction,
    });

    // Then
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      label: "New chat",
      group: "Create",
      leaderKeys: ["o", "c"],
    });
    entries[0].onSelect();
    expect(command.onSelect).toHaveBeenCalledOnce();
    expect(runLeaderAction).not.toHaveBeenCalled();
  });

  it("shows no leader keys for a palette command whose leader action is not registered", () => {
    // When
    const entries = build({
      commands: [paletteCommand("workbench:new-chat", "New chat", "Create")],
    });

    // Then
    expect(entryById(entries, "workbench:new-chat").leaderKeys).toBeNull();
  });

  it("leaves out the leader action that opens the palette itself", () => {
    // When
    const entries = build({
      leaderActions: [
        leaderAction("global:command-palette", "Open command palette"),
        leaderAction("global:file-picker", "Open file picker"),
      ],
    });

    // Then
    expect(entries.map((entry) => entry.id)).toEqual(["global:file-picker"]);
  });

  it.each([
    { id: "workbench:close-tab", group: "Workbench" },
    { id: "chat:switch-model", group: "Chat" },
    { id: "git:push", group: "Git" },
    { id: "global:find-in-files", group: "Pickers" },
    { id: "nav:settings", group: "Navigation" },
    { id: "lab:experiment", group: "Other" },
  ])("files the $id leader action under $group", ({ id, group }) => {
    // When
    const entries = build({ leaderActions: [leaderAction(id, id)] });

    // Then
    expect(entryById(entries, id).group).toBe(group);
  });
});

describe("the Go to tab entry", () => {
  it("folds the nine tab actions into one line with the 1–9 shorthand", () => {
    // When
    const entries = build({
      leaderActions: [
        leaderAction("workbench:next-tab", "Next tab"),
        ...tabActions,
        leaderAction("workbench:close-tab", "Close tab"),
      ],
    });

    // Then
    expect(
      entries.map(({ id, label, leaderKeys }) => ({ id, label, leaderKeys })),
    ).toEqual([
      { id: "workbench:next-tab", label: "Next tab", leaderKeys: null },
      {
        id: "workbench:focus-tab",
        label: "Go to tab 1–9",
        leaderKeys: ["1–9"],
      },
      { id: "workbench:close-tab", label: "Close tab", leaderKeys: null },
    ]);
  });

  it.each([
    { search: "tab 3", label: "Go to tab 3", tabNumber: 3 },
    { search: "go to tab 7", label: "Go to tab 7", tabNumber: 7 },
    { search: "2", label: "Go to tab 2", tabNumber: 2 },
    { search: "last tab", label: "Go to last tab", tabNumber: 9 },
  ])(
    "goes straight to the tab the search names: $search",
    ({ search, label, tabNumber }) => {
      // Given
      const runLeaderAction = vi.fn();
      const entry = entryById(
        build({ leaderActions: tabActions, runLeaderAction, search }),
        "workbench:focus-tab",
      );

      // When
      entry.onSelect();

      // Then
      expect(entry).toMatchObject({
        label,
        leaderKeys: [String(tabNumber)],
      });
      expect(runLeaderAction).toHaveBeenCalledExactlyOnceWith(
        `workbench:focus-tab-${tabNumber}`,
      );
    },
  );

  it("asks for a tab number, keeping the palette open, when the search names none", () => {
    // Given
    const runLeaderAction = vi.fn();
    const promptForTabNumber = vi.fn();
    const entry = entryById(
      build({
        leaderActions: tabActions,
        runLeaderAction,
        promptForTabNumber,
        search: "go to tab",
      }),
      "workbench:focus-tab",
    );

    // When
    entry.onSelect();

    // Then
    expect(entry.keepsPaletteOpen).toBe(true);
    expect(promptForTabNumber).toHaveBeenCalledOnce();
    expect(runLeaderAction).not.toHaveBeenCalled();
  });

  it("drops the 1–9 shorthand when the tab keys are remapped", () => {
    // When
    const entries = build({
      leaderActions: tabActions,
      bindings: { ...bindings, "workbench:focus-tab-3": "x" },
    });

    // Then
    expect(entryById(entries, "workbench:focus-tab").leaderKeys).toBeNull();
  });
});

describe("groupPaletteEntries", () => {
  it("lists known groups in palette order and unknown groups after them", () => {
    // Given
    const entries = build({
      commands: [
        paletteCommand("workspace:switch:a", "Switch to a", "Workspaces"),
        paletteCommand("quick-command:a:pnpm dev", "Dev", "Run"),
        paletteCommand("lab:one", "One", "Lab"),
      ],
      leaderActions: [
        leaderAction("nav:git", "Go to Git"),
        leaderAction("git:push", "Push to remote"),
        leaderAction("workbench:close-tab", "Close tab"),
        leaderAction("chat:switch-model", "Switch model"),
      ],
    });

    // When
    const groups = groupPaletteEntries(entries, []);

    // Then
    expect(groups.map((group) => group.name)).toEqual([
      "Workbench",
      "Chat",
      "Workspaces",
      "Run",
      "Git",
      "Navigation",
      "Lab",
    ]);
  });

  it("pins recently run commands, newest first, in a Recent group on top", () => {
    // Given
    const entries = build({
      leaderActions: [
        leaderAction("workbench:close-tab", "Close tab"),
        leaderAction("chat:switch-model", "Switch model"),
        leaderAction("git:push", "Push to remote"),
      ],
    });

    // When
    const groups = groupPaletteEntries(entries, [
      "git:push",
      "no-longer-registered",
      "workbench:close-tab",
    ]);

    // Then
    expect(
      groups.map((group) => ({
        name: group.name,
        ids: group.entries.map((entry) => entry.id),
      })),
    ).toEqual([
      { name: "Recent", ids: ["git:push", "workbench:close-tab"] },
      { name: "Chat", ids: ["chat:switch-model"] },
    ]);
  });
});

describe("rankPaletteGroups", () => {
  function groupsOf(entries: PaletteEntry[]) {
    return groupPaletteEntries(entries, []);
  }

  const entries = build({
    commands: [
      paletteCommand("workspace:clone-repo", "Clone repo", "Workspaces"),
      {
        ...paletteCommand(
          "workspace:create-worktree",
          "Create worktree",
          "Workspaces",
        ),
        keywords: ["add worktree"],
      },
    ],
    leaderActions: [
      leaderAction("workbench:focus-group-down", "Focus group below"),
      leaderAction("workbench:close-tab", "Close tab"),
    ],
  });

  it("puts the best match first even when its group comes later", () => {
    // When
    const ranked = rankPaletteGroups(groupsOf(entries), "clone repo");

    // Then
    expect(
      ranked.map((group) => group.entries.map((entry) => entry.label)),
    ).toEqual([["Clone repo"]]);
  });

  it("finds a command by one of its keyword phrases", () => {
    // When
    const ranked = rankPaletteGroups(groupsOf(entries), "add worktree");

    // Then
    expect(ranked[0]?.entries[0]?.id).toBe("workspace:create-worktree");
  });

  it("keeps every group in palette order while nothing is typed", () => {
    // When
    const ranked = rankPaletteGroups(groupsOf(entries), "  ");

    // Then
    expect(ranked.map((group) => group.name)).toEqual([
      "Workbench",
      "Workspaces",
    ]);
  });

  it("drops every command that does not match", () => {
    // When
    const ranked = rankPaletteGroups(groupsOf(entries), "zzz");

    // Then
    expect(ranked).toEqual([]);
  });
});

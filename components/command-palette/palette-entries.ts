import { defaultFilter } from "cmdk";
import type { PaletteCommand } from "@/components/providers/command-palette-provider";
import type { WorkbenchTabNumber } from "@/lib/workbench/workbench-shortcuts";
import type { LeaderAction, LeaderBindingsMap } from "@/types/leader-key";

export interface PaletteEntry extends PaletteCommand {
  // The leader sequence that runs the same action right now, e.g. ["o", "c"].
  readonly leaderKeys: readonly string[] | null;
  // Picking it asks for more in the palette instead of running a command.
  readonly keepsPaletteOpen?: boolean;
}

export interface PaletteGroup {
  readonly name: string;
  readonly entries: readonly PaletteEntry[];
}

interface BuildPaletteEntriesInput {
  readonly commands: readonly PaletteCommand[];
  readonly leaderActions: readonly LeaderAction[];
  readonly bindings: LeaderBindingsMap;
  readonly runLeaderAction: (actionId: string) => void;
  // The typed search, so "tab 3" turns the Go to tab line into tab 3.
  readonly search: string;
  // Asks for a tab number when Go to tab is picked without one.
  readonly promptForTabNumber: () => void;
}

type LeaderKeysLookup = (actionId: string) => readonly string[] | null;

// Leader actions carry no group, so their id prefix picks one.
const LEADER_GROUP_BY_ID_PREFIX: Readonly<Record<string, string>> = {
  workbench: "Workbench",
  chat: "Chat",
  files: "Files",
  git: "Git",
  tasks: "Tasks",
  global: "Pickers",
  nav: "Navigation",
};

// Order of the unfiltered list. While typing, cmdk ranks by match instead.
const GROUP_ORDER: readonly string[] = [
  "Workbench",
  "Chat",
  "Workspaces",
  "Run",
  "Git",
  "Pickers",
  "Files",
  "Tasks",
  "Navigation",
];

const RECENT_GROUP_NAME = "Recent";

// Opening the palette from the palette does nothing.
const HIDDEN_LEADER_ACTION_IDS: ReadonlySet<string> = new Set([
  "global:command-palette",
]);

// The nine workbench:focus-tab-N leader actions show as one line.
const TAB_ACTION_ID_PREFIX = "workbench:focus-tab-";
const TAB_ENTRY_ID = "workbench:focus-tab";
const TAB_NUMBERS: readonly WorkbenchTabNumber[] = [1, 2, 3, 4, 5, 6, 7, 8, 9];

function leaderGroupFor(actionId: string): string {
  const prefix = actionId.split(":")[0];
  return LEADER_GROUP_BY_ID_PREFIX[prefix] ?? "Other";
}

function tabActionId(tabNumber: WorkbenchTabNumber): string {
  return `${TAB_ACTION_ID_PREFIX}${tabNumber}`;
}

// A trailing digit names that tab ("tab 3", "3"); "last" names the last one.
function tabNumberInSearch(search: string): WorkbenchTabNumber | null {
  const digit = /(?:^|\s)([1-9])\s*$/.exec(search)?.[1];
  const tabNumber = TAB_NUMBERS.find(
    (candidate) => String(candidate) === digit,
  );
  if (tabNumber !== undefined) return tabNumber;
  return /\blast\b/i.test(search) ? 9 : null;
}

function buildTabEntry(
  input: BuildPaletteEntriesInput,
  leaderKeysFor: LeaderKeysLookup,
): PaletteEntry {
  const tabNumber = tabNumberInSearch(input.search);
  if (tabNumber === null) {
    // "1–9" is only true while every tab keeps its default digit key.
    const hasDigitKeys = TAB_NUMBERS.every(
      (candidate) =>
        input.bindings[tabActionId(candidate)] === String(candidate),
    );
    return {
      id: TAB_ENTRY_ID,
      label: "Go to tab 1–9",
      group: "Workbench",
      leaderKeys: hasDigitKeys ? ["1–9"] : null,
      keepsPaletteOpen: true,
      onSelect: input.promptForTabNumber,
    };
  }
  const actionId = tabActionId(tabNumber);
  return {
    id: TAB_ENTRY_ID,
    label: tabNumber === 9 ? "Go to last tab" : `Go to tab ${tabNumber}`,
    group: "Workbench",
    leaderKeys: leaderKeysFor(actionId),
    onSelect: () => input.runLeaderAction(actionId),
  };
}

// Lists every palette command plus every leader action registered right now.
// A palette command wins over a leader action with the same id (it has the
// better label), and borrows that action's keys as its hint.
export function buildPaletteEntries(
  input: BuildPaletteEntriesInput,
): PaletteEntry[] {
  const { commands, leaderActions, bindings, runLeaderAction } = input;
  const registeredLeaderIds = new Set(leaderActions.map((action) => action.id));
  const commandIds = new Set(commands.map((command) => command.id));

  // Only a registered action's keys do anything, so only those are shown.
  function leaderKeysFor(actionId: string): readonly string[] | null {
    if (!registeredLeaderIds.has(actionId)) return null;
    const keys = (bindings[actionId] ?? "").split(" ").filter(Boolean);
    return keys.length > 0 ? keys : null;
  }

  const commandEntries = commands.map((command) => ({
    ...command,
    leaderKeys: leaderKeysFor(command.id),
  }));
  const leaderEntries: PaletteEntry[] = [];
  let hasTabEntry = false;
  for (const action of leaderActions) {
    if (commandIds.has(action.id) || HIDDEN_LEADER_ACTION_IDS.has(action.id)) {
      continue;
    }
    if (action.id.startsWith(TAB_ACTION_ID_PREFIX)) {
      if (!hasTabEntry) leaderEntries.push(buildTabEntry(input, leaderKeysFor));
      hasTabEntry = true;
      continue;
    }
    leaderEntries.push({
      id: action.id,
      label: action.label,
      group: leaderGroupFor(action.id),
      icon: action.icon,
      onSelect: () => runLeaderAction(action.id),
      leaderKeys: leaderKeysFor(action.id),
    });
  }
  return [...commandEntries, ...leaderEntries];
}

function groupRank(groupName: string): number {
  const index = GROUP_ORDER.indexOf(groupName);
  return index === -1 ? GROUP_ORDER.length : index;
}

// Recently run commands (newest first) move to a Recent group on top.
export function groupPaletteEntries(
  entries: readonly PaletteEntry[],
  recentCommandIds: readonly string[],
): PaletteGroup[] {
  const entryById = new Map(entries.map((entry) => [entry.id, entry]));
  const recentEntries = recentCommandIds.flatMap((id) => {
    const entry = entryById.get(id);
    return entry ? [entry] : [];
  });
  const recentIds = new Set(recentEntries.map((entry) => entry.id));
  const entriesByGroup = new Map<string, PaletteEntry[]>();
  for (const entry of entries) {
    if (recentIds.has(entry.id)) continue;
    const groupEntries = entriesByGroup.get(entry.group);
    if (groupEntries) groupEntries.push(entry);
    else entriesByGroup.set(entry.group, [entry]);
  }
  const groups = Array.from(entriesByGroup, ([name, groupEntries]) => ({
    name,
    entries: groupEntries,
  })).sort((a, b) => groupRank(a.name) - groupRank(b.name));
  return recentEntries.length > 0
    ? [{ name: RECENT_GROUP_NAME, entries: recentEntries }, ...groups]
    : groups;
}

interface RankedGroup {
  readonly group: PaletteGroup;
  readonly bestScore: number;
}

// cmdk 1.1 ranks items inside a group but never moves whole groups, so it
// would pick a weak match in an early group over an exact one further down.
// While something is typed, the palette ranks every command itself.
export function rankPaletteGroups(
  groups: readonly PaletteGroup[],
  search: string,
): PaletteGroup[] {
  const query = search.trim();
  if (query === "") return [...groups];
  const rankedGroups: RankedGroup[] = [];
  for (const group of groups) {
    const scoredEntries = group.entries
      .map((entry) => ({
        entry,
        // Not the id: "workbench:focus-group-down" must not match "clone repo".
        score: defaultFilter(
          `${entry.label} ${entry.group}`,
          query,
          entry.keywords,
        ),
      }))
      .filter((scored) => scored.score > 0)
      .sort((a, b) => b.score - a.score);
    if (scoredEntries.length === 0) continue;
    rankedGroups.push({
      group: {
        name: group.name,
        entries: scoredEntries.map((scored) => scored.entry),
      },
      bestScore: scoredEntries[0].score,
    });
  }
  return rankedGroups
    .sort((a, b) => b.bestScore - a.bestScore)
    .map((ranked) => ranked.group);
}

import { describe, expect, it } from "vitest";
import {
  BUILTIN_ACTIONS,
  DEFAULT_LEADER_BINDINGS,
} from "@/lib/leader-key-defaults";

describe("leader-key-defaults nav:prs", () => {
  it("binds nav:prs to 'g p'", () => {
    expect(DEFAULT_LEADER_BINDINGS["nav:prs"]).toBe("g p");
  });

  it("includes a nav:prs builtin action", () => {
    const prsAction = BUILTIN_ACTIONS.find((a) => a.id === "nav:prs");
    expect(prsAction).toBeTruthy();
    expect(prsAction?.page).toBe("global");
  });

  it("does not map any other action to 'g p'", () => {
    const collisions = Object.entries(DEFAULT_LEADER_BINDINGS).filter(
      ([id, keys]) => keys === "g p" && id !== "nav:prs",
    );
    expect(collisions).toEqual([]);
  });
});

describe("leader-key-defaults chat:toggle-collapse-finished-thinking", () => {
  const actionId = "chat:toggle-collapse-finished-thinking";

  it("is a chat action bound to 'C'", () => {
    const action = BUILTIN_ACTIONS.find((a) => a.id === actionId);
    expect(action?.page).toBe("chat");
    expect(DEFAULT_LEADER_BINDINGS[actionId]).toBe("C");
  });

  it("does not share 'C' with another chat or global action", () => {
    const pageByActionId = new Map(BUILTIN_ACTIONS.map((a) => [a.id, a.page]));
    const collisions = Object.entries(DEFAULT_LEADER_BINDINGS).filter(
      ([id, keys]) =>
        keys === "C" &&
        id !== actionId &&
        ["chat", "global"].includes(pageByActionId.get(id) ?? ""),
    );
    expect(collisions).toEqual([]);
  });
});

describe("leader-key-defaults global:find-in-files", () => {
  it("binds global:find-in-files to '/'", () => {
    expect(DEFAULT_LEADER_BINDINGS["global:find-in-files"]).toBe("/");
  });

  it("does not map any other action to '/'", () => {
    const collisions = Object.entries(DEFAULT_LEADER_BINDINGS).filter(
      ([id, keys]) => keys === "/" && id !== "global:find-in-files",
    );
    expect(collisions).toEqual([]);
  });

  it("includes a global find-in-files builtin action", () => {
    const findAction = BUILTIN_ACTIONS.find(
      (a) => a.id === "global:find-in-files",
    );
    expect(findAction?.page).toBe("global");
  });
});

describe("leader-key-defaults workbench remap", () => {
  it.each([
    { id: "workbench:next-tab", keys: "]" },
    { id: "workbench:prev-tab", keys: "[" },
    { id: "workbench:focus-tab-1", keys: "1" },
    { id: "workbench:focus-tab-2", keys: "2" },
    { id: "workbench:focus-tab-3", keys: "3" },
    { id: "workbench:focus-tab-4", keys: "4" },
    { id: "workbench:focus-tab-5", keys: "5" },
    { id: "workbench:focus-tab-6", keys: "6" },
    { id: "workbench:focus-tab-7", keys: "7" },
    { id: "workbench:focus-tab-8", keys: "8" },
    { id: "workbench:focus-tab-9", keys: "9" },
    { id: "workbench:close-tab", keys: "q" },
    { id: "workbench:split-right", keys: "|" },
    { id: "workbench:split-down", keys: "-" },
    { id: "workbench:move-tab-right", keys: ">" },
    { id: "workbench:move-tab-left", keys: "<" },
    { id: "workbench:focus-group-left", keys: "H" },
    { id: "workbench:focus-group-right", keys: "L" },
    { id: "workbench:focus-group-up", keys: "K" },
    { id: "workbench:focus-group-down", keys: "J" },
    { id: "workbench:new-terminal", keys: "o t" },
    { id: "workbench:new-chat", keys: "o c" },
    { id: "workbench:toggle-context-sidebar", keys: "B" },
  ])("binds the workbench action $id to $keys", ({ id, keys }) => {
    const action = BUILTIN_ACTIONS.find((candidate) => candidate.id === id);

    expect(action?.page).toBe("workbench");
    expect(DEFAULT_LEADER_BINDINGS[id]).toBe(keys);
  });

  it("makes only next and previous tab repeatable among workbench actions", () => {
    const repeatableWorkbenchIds = BUILTIN_ACTIONS.filter(
      (action) => action.page === "workbench" && action.isRepeatable === true,
    ).map((action) => action.id);

    expect(repeatableWorkbenchIds).toEqual([
      "workbench:next-tab",
      "workbench:prev-tab",
    ]);
  });

  it.each(["files:next-tab", "files:prev-tab", "files:close-tab"])(
    "drops the superseded %s from both lists",
    (actionId) => {
      const builtinIds = BUILTIN_ACTIONS.map((action) => action.id);

      expect(builtinIds).not.toContain(actionId);
      expect(DEFAULT_LEADER_BINDINGS).not.toHaveProperty(actionId);
    },
  );

  it("moves the first and last user message jumps to { and }", () => {
    expect(DEFAULT_LEADER_BINDINGS).toMatchObject({
      "chat:first-user-message": "{",
      "chat:last-user-message": "}",
    });
  });

  it.each([
    { id: "files:save", keys: "S" },
    { id: "files:focus-search", keys: "i" },
    { id: "files:focus-tree", keys: "h" },
    { id: "files:focus-editor", keys: "l" },
  ])("keeps the file tab action $id on $keys", ({ id, keys }) => {
    expect(DEFAULT_LEADER_BINDINGS[id]).toBe(keys);
  });
});

describe("leader-key-defaults workbench navigation", () => {
  it("adds a global nav:workbench action bound to 'g w'", () => {
    const workbenchAction = BUILTIN_ACTIONS.find(
      (action) => action.id === "nav:workbench",
    );

    expect(workbenchAction).toEqual({
      id: "nav:workbench",
      label: "Go to Workbench",
      page: "global",
    });
    expect(DEFAULT_LEADER_BINDINGS["nav:workbench"]).toBe("g w");
  });

  it("does not map any other action to 'g w'", () => {
    const collisions = Object.entries(DEFAULT_LEADER_BINDINGS).filter(
      ([id, keys]) => keys === "g w" && id !== "nav:workbench",
    );

    expect(collisions).toEqual([]);
  });

  it.each([
    { id: "nav:chat", label: "Focus chat tab", keys: "g c" },
    { id: "nav:files", label: "Focus file tab", keys: "g f" },
    { id: "nav:terminal", label: "Focus terminal tab", keys: "g m" },
  ])(
    "keeps $id on '$keys' as a global '$label' action",
    ({ id, label, keys }) => {
      const action = BUILTIN_ACTIONS.find((candidate) => candidate.id === id);

      expect(action).toEqual({ id, label, page: "global" });
      expect(DEFAULT_LEADER_BINDINGS[id]).toBe(keys);
    },
  );
});

describe("leader-key-defaults consistency", () => {
  it("binds only built-in actions", () => {
    const builtinIds = new Set(BUILTIN_ACTIONS.map((action) => action.id));

    const unknownBindings = Object.keys(DEFAULT_LEADER_BINDINGS).filter(
      (actionId) => !builtinIds.has(actionId),
    );

    expect(unknownBindings).toEqual([]);
  });

  it("gives every built-in action a default binding", () => {
    const unboundActions = BUILTIN_ACTIONS.filter(
      (action) => DEFAULT_LEADER_BINDINGS[action.id] === undefined,
    ).map((action) => action.id);

    expect(unboundActions).toEqual([]);
  });
});

// Only the focused tab registers chat:* or files:*, so on the workbench route
// one of these sets is live at a time next to the workbench and global actions.
const CONCURRENT_PAGE_SETS = [
  {
    name: "global, workbench and chat",
    pages: ["global", "workbench", "chat"],
  },
  {
    name: "global, workbench and files",
    pages: ["global", "workbench", "files"],
  },
];

function keySequencesForPages(pages: readonly string[]) {
  const pageByActionId = new Map(
    BUILTIN_ACTIONS.map((action) => [action.id, action.page]),
  );
  return Object.entries(DEFAULT_LEADER_BINDINGS)
    .filter(([actionId]) => pages.includes(pageByActionId.get(actionId) ?? ""))
    .map(([actionId, keys]) => ({
      actionId,
      sequence: keys.split(" ").filter(Boolean),
    }));
}

function isStrictPrefix(
  shorter: readonly string[],
  longer: readonly string[],
): boolean {
  return (
    shorter.length < longer.length &&
    shorter.every((key, index) => longer[index] === key)
  );
}

describe("leader-key-defaults concurrently registered actions", () => {
  it.each(CONCURRENT_PAGE_SETS)(
    "gives no two $name actions the same key sequence",
    ({ pages }) => {
      const actionIdsBySequence = new Map<string, string[]>();
      for (const { actionId, sequence } of keySequencesForPages(pages)) {
        const sequenceKey = sequence.join(" ");
        actionIdsBySequence.set(sequenceKey, [
          ...(actionIdsBySequence.get(sequenceKey) ?? []),
          actionId,
        ]);
      }

      const sharedSequences = [...actionIdsBySequence.entries()].filter(
        ([, actionIds]) => actionIds.length > 1,
      );

      expect(sharedSequences).toEqual([]);
    },
  );

  it.each(CONCURRENT_PAGE_SETS)(
    "never makes one $name binding a strict prefix of another",
    ({ pages }) => {
      const sequences = keySequencesForPages(pages);

      const prefixPairs = sequences.flatMap((shorter) =>
        sequences
          .filter((longer) => isStrictPrefix(shorter.sequence, longer.sequence))
          .map((longer) => `${shorter.actionId} -> ${longer.actionId}`),
      );

      expect(prefixPairs).toEqual([]);
    },
  );
});

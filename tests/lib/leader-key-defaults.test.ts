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

describe("leader-key-defaults file tab actions", () => {
  const tabActionIds = ["files:next-tab", "files:prev-tab", "files:close-tab"];

  it("binds next, previous and close tab to ], [ and q", () => {
    expect(DEFAULT_LEADER_BINDINGS).toMatchObject({
      "files:next-tab": "]",
      "files:prev-tab": "[",
      "files:close-tab": "q",
    });
  });

  it("lists them as files-page actions with only next and previous repeatable", () => {
    const tabActions = BUILTIN_ACTIONS.filter((action) =>
      tabActionIds.includes(action.id),
    ).map(({ id, page, isRepeatable }) => ({
      id,
      page,
      isRepeatable: isRepeatable === true,
    }));

    expect(tabActions).toEqual([
      { id: "files:next-tab", page: "files", isRepeatable: true },
      { id: "files:prev-tab", page: "files", isRepeatable: true },
      { id: "files:close-tab", page: "files", isRepeatable: false },
    ]);
  });

  it("does not share a first key with any other files-page or global binding", () => {
    const pageByActionId = new Map(
      BUILTIN_ACTIONS.map((action) => [action.id, action.page]),
    );
    const tabKeys = tabActionIds.map((id) => DEFAULT_LEADER_BINDINGS[id]);

    const collisions = Object.entries(DEFAULT_LEADER_BINDINGS).filter(
      ([actionId, keys]) => {
        const page = pageByActionId.get(actionId);
        const isReachableOnFilesPage = page === "files" || page === "global";
        if (tabActionIds.includes(actionId) || !isReachableOnFilesPage)
          return false;
        return tabKeys.includes(keys.split(" ")[0]);
      },
    );

    expect(collisions).toEqual([]);
  });
});

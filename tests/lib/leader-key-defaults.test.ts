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

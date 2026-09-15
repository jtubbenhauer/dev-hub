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

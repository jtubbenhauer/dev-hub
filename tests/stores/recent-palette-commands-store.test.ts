import { beforeEach, describe, expect, it } from "vitest";
import { useRecentPaletteCommandsStore } from "@/stores/recent-palette-commands-store";

const STORAGE_KEY = "dev-hub:recent-palette-commands";

function recordCommands(...commandIds: string[]) {
  for (const commandId of commandIds) {
    useRecentPaletteCommandsStore.getState().recordCommand(commandId);
  }
}

beforeEach(() => {
  localStorage.clear();
  useRecentPaletteCommandsStore.setState({ recentCommandIds: [] });
});

describe("useRecentPaletteCommandsStore", () => {
  it("puts the command just run first and lists it once", () => {
    // When
    recordCommands("git:push", "workbench:new-chat", "git:push");

    // Then
    expect(useRecentPaletteCommandsStore.getState().recentCommandIds).toEqual([
      "git:push",
      "workbench:new-chat",
    ]);
  });

  it("keeps only the five most recent commands", () => {
    // When
    recordCommands("a", "b", "c", "d", "e", "f");

    // Then
    expect(useRecentPaletteCommandsStore.getState().recentCommandIds).toEqual([
      "f",
      "e",
      "d",
      "c",
      "b",
    ]);
  });

  it("keeps the saved ids that are strings when restoring a damaged list", async () => {
    // Given
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        state: { recentCommandIds: ["git:push", 7, null, "nav:git"] },
        version: 1,
      }),
    );

    // When
    await useRecentPaletteCommandsStore.persist.rehydrate();

    // Then
    expect(useRecentPaletteCommandsStore.getState().recentCommandIds).toEqual([
      "git:push",
      "nav:git",
    ]);
  });
});

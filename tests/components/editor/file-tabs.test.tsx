import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEditorStore } from "@/stores/editor-store";
import type { OpenFile } from "@/types";

interface LeaderRegistration {
  action: { id: string; isRepeatable?: boolean };
  handler: () => void;
}

let leaderRegistrations: LeaderRegistration[] = [];

vi.mock("@/hooks/use-leader-action", () => ({
  useLeaderAction: (registrations: LeaderRegistration[]) => {
    leaderRegistrations = registrations;
  },
}));

import { FileTabs } from "@/components/editor/file-tabs";

function makeFile(path: string, isDirty = false): OpenFile {
  return {
    path,
    name: path,
    content: isDirty ? "edited" : "original",
    language: "typescript",
    isDirty,
    originalContent: "original",
  };
}

function setOpenTabs(files: OpenFile[], activeFilePath: string | null) {
  useEditorStore.setState({ openFiles: files, activeFilePath });
}

function getOpenTabPaths() {
  return useEditorStore.getState().openFiles.map((file) => file.path);
}

function runLeaderAction(actionId: string) {
  const registration = leaderRegistrations.find(
    (candidate) => candidate.action.id === actionId,
  );
  expect(registration).toBeDefined();
  act(() => registration?.handler());
}

describe("FileTabs", () => {
  beforeEach(() => {
    leaderRegistrations = [];
    setOpenTabs([], null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("tab close button", () => {
    it("closes a clean tab without asking", async () => {
      const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
      setOpenTabs([makeFile("a.ts"), makeFile("b.ts")], "a.ts");
      render(<FileTabs />);

      await userEvent.click(screen.getByRole("button", { name: "Close a.ts" }));

      expect(getOpenTabPaths()).toEqual(["b.ts"]);
      expect(confirmSpy).not.toHaveBeenCalled();
    });

    it("keeps a dirty tab open when discarding is declined", async () => {
      vi.spyOn(window, "confirm").mockReturnValue(false);
      setOpenTabs([makeFile("a.ts", true), makeFile("b.ts")], "a.ts");
      render(<FileTabs />);

      await userEvent.click(screen.getByRole("button", { name: "Close a.ts" }));

      expect(getOpenTabPaths()).toEqual(["a.ts", "b.ts"]);
    });

    it("closes a dirty tab when discarding is accepted", async () => {
      vi.spyOn(window, "confirm").mockReturnValue(true);
      setOpenTabs([makeFile("a.ts", true), makeFile("b.ts")], "a.ts");
      render(<FileTabs />);

      await userEvent.click(screen.getByRole("button", { name: "Close a.ts" }));

      expect(getOpenTabPaths()).toEqual(["b.ts"]);
    });
  });

  describe("leader actions", () => {
    it("activates the next tab", () => {
      setOpenTabs(
        [makeFile("a.ts"), makeFile("b.ts"), makeFile("c.ts")],
        "a.ts",
      );
      render(<FileTabs />);

      runLeaderAction("files:next-tab");

      expect(useEditorStore.getState().activeFilePath).toBe("b.ts");
    });

    it("activates the previous tab", () => {
      setOpenTabs(
        [makeFile("a.ts"), makeFile("b.ts"), makeFile("c.ts")],
        "a.ts",
      );
      render(<FileTabs />);

      runLeaderAction("files:prev-tab");

      expect(useEditorStore.getState().activeFilePath).toBe("c.ts");
    });

    it("closes the active tab", () => {
      setOpenTabs([makeFile("a.ts"), makeFile("b.ts")], "b.ts");
      render(<FileTabs />);

      runLeaderAction("files:close-tab");

      expect(getOpenTabPaths()).toEqual(["a.ts"]);
    });

    it("keeps a dirty active tab open when discarding is declined", () => {
      vi.spyOn(window, "confirm").mockReturnValue(false);
      setOpenTabs([makeFile("a.ts"), makeFile("b.ts", true)], "b.ts");
      render(<FileTabs />);

      runLeaderAction("files:close-tab");

      expect(getOpenTabPaths()).toEqual(["a.ts", "b.ts"]);
    });

    it("makes next and previous tab repeatable but not close tab", () => {
      render(<FileTabs />);

      const repeatableActionIds = leaderRegistrations
        .filter((registration) => registration.action.isRepeatable)
        .map((registration) => registration.action.id);

      expect(repeatableActionIds).toEqual(["files:next-tab", "files:prev-tab"]);
    });
  });
});

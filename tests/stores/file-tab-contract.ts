import { beforeEach, describe, expect, it } from "vitest";
import type { OpenFile } from "@/types";

type TabStore = {
  openFiles: OpenFile[];
  activeFilePath: string | null;
  updateFileContent(path: string, content: string): void;
  replaceFileContentFromDisk(
    workspaceId: string,
    path: string,
    content: string,
  ): string;
  markFileSavedAs(input: {
    path: string;
    instanceId: number | undefined;
    submittedBase: string;
    savedContent: string;
  }): string;
};

export function fileTabContract(input: {
  getState: () => TabStore;
  reset: () => void;
  open: (workspaceId?: string) => string;
  close: () => void;
}) {
  describe("workspace-bound tab contract", () => {
    beforeEach(input.reset);
    it("assigns an identity when opened", () => {
      expect(input.open("A")).toBe("opened");
      expect(input.getState().openFiles[0]).toMatchObject({
        workspaceId: "A",
        instanceId: expect.any(Number),
      });
    });
    it.each(["A", undefined])(
      "preserves identity when reactivated as %s",
      (workspaceId) => {
        input.open("A");
        const file = input.getState().openFiles[0];
        expect(input.open(workspaceId)).toBe("activated");
        expect(input.getState().openFiles[0]).toBe(file);
      },
    );
    it("replaces a clean foreign collision", () => {
      input.open("A");
      const previous = input.getState().openFiles[0];
      expect(input.open("B")).toBe("replaced-foreign");
      expect(input.getState().openFiles[0]).toMatchObject({
        workspaceId: "B",
        content: "B",
        originalContent: "B",
        isDirty: false,
      });
      expect(input.getState().openFiles[0].instanceId).not.toBe(
        previous.instanceId,
      );
    });
    it("keeps a dirty foreign collision", () => {
      input.open("A");
      input.getState().updateFileContent("a.ts", "unsaved");
      const previous = input.getState().openFiles[0];
      expect(input.open("B")).toBe("kept-foreign-dirty");
      expect(input.getState().openFiles[0]).toBe(previous);
      expect(input.getState().activeFilePath).toBe("a.ts");
    });
    it("keeps new typing dirty when acknowledging a snapshot", () => {
      input.open("A");
      const { instanceId } = input.getState().openFiles[0];
      input.getState().updateFileContent("a.ts", "v1");
      const snapshot = {
        path: "a.ts",
        instanceId,
        submittedBase: "A",
        savedContent: "v1",
      };
      input.getState().updateFileContent("a.ts", "v2");
      expect(input.getState().markFileSavedAs(snapshot)).toBe("acknowledged");
      expect(input.getState().openFiles[0]).toMatchObject({
        content: "v2",
        originalContent: "v1",
        isDirty: true,
      });
    });
    it.each(["closed", "reopened", "reloaded"])(
      "ignores a save when %s",
      (change) => {
        input.open("A");
        const { instanceId } = input.getState().openFiles[0];
        if (change === "reloaded")
          input.getState().replaceFileContentFromDisk("A", "a.ts", "new base");
        else {
          input.close();
          if (change === "reopened") input.open("A");
        }
        const before = input.getState();
        expect(
          input.getState().markFileSavedAs({
            path: "a.ts",
            instanceId,
            submittedBase: "A",
            savedContent: "v1",
          }),
        ).toBe("ignored");
        expect(input.getState()).toBe(before);
      },
    );
    it.each([undefined, "A"])(
      "does not reload a tab belonging to %s for B",
      (workspaceId) => {
        input.open(workspaceId);
        const before = input.getState();
        expect(
          input.getState().replaceFileContentFromDisk("B", "a.ts", "disk"),
        ).toBe("not-open");
        expect(input.getState()).toBe(before);
      },
    );
    it("does not treat a foreign dirty tab as matching", () => {
      input.open("A");
      input.getState().updateFileContent("a.ts", "dirty");
      expect(
        input.getState().replaceFileContentFromDisk("B", "a.ts", "disk"),
      ).toBe("not-open");
      expect(input.getState().openFiles[0].content).toBe("dirty");
    });
    it("replaces both contents when matching and clean", () => {
      input.open("B");
      const { instanceId } = input.getState().openFiles[0];
      expect(
        input.getState().replaceFileContentFromDisk("B", "a.ts", "disk"),
      ).toBe("replaced");
      expect(input.getState().openFiles[0]).toMatchObject({
        content: "disk",
        originalContent: "disk",
        isDirty: false,
        instanceId,
      });
    });
    it("skips a matching dirty tab", () => {
      input.open("B");
      input.getState().updateFileContent("a.ts", "dirty");
      const before = input.getState();
      expect(
        input.getState().replaceFileContentFromDisk("B", "a.ts", "disk"),
      ).toBe("dirty-skipped");
      expect(input.getState()).toBe(before);
    });
  });
}

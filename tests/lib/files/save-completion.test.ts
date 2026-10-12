import { describe, expect, it, vi } from "vitest";
import { completeFileSave } from "@/lib/files/save-completion";

describe("completeFileSave", () => {
  it.each(["acknowledged", "ignored"] as const)(
    "returns %s and gates follow-ups",
    (result) => {
      const acknowledge = vi.fn(() => result);
      const runFollowUps = vi.fn();
      expect(
        completeFileSave({
          snapshotWorkspaceId: "A",
          getBoundWorkspaceId: () => "A",
          acknowledge,
          runFollowUps,
        }),
      ).toBe(result);
      expect(acknowledge).toHaveBeenCalledOnce();
      expect(runFollowUps).toHaveBeenCalledTimes(
        result === "acknowledged" ? 1 : 0,
      );
    },
  );
  it.each(["B", null, undefined])(
    "acknowledges without follow-ups when bound to %s",
    (bound) => {
      const acknowledge = vi.fn(() => "acknowledged" as const);
      const runFollowUps = vi.fn();
      expect(
        completeFileSave({
          snapshotWorkspaceId: "A",
          getBoundWorkspaceId: () => bound,
          acknowledge,
          runFollowUps,
        }),
      ).toBe("acknowledged");
      expect(acknowledge).toHaveBeenCalledOnce();
      expect(runFollowUps).not.toHaveBeenCalled();
    },
  );
  it("evaluates the bound workspace after acknowledgment at completion", () => {
    let workspaceId = "A";
    const getBoundWorkspaceId = () => workspaceId;
    const snapshotWorkspaceId = getBoundWorkspaceId();
    const runFollowUps = vi.fn();
    completeFileSave({
      snapshotWorkspaceId,
      getBoundWorkspaceId,
      acknowledge: () => {
        workspaceId = "B";
        return "acknowledged";
      },
      runFollowUps,
    });
    expect(runFollowUps).not.toHaveBeenCalled();
  });
});

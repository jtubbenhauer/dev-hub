import type { SaveAcknowledgment } from "@/lib/files/tab-state";

export function completeFileSave(input: {
  readonly snapshotWorkspaceId: string;
  readonly getBoundWorkspaceId: () => string | null | undefined;
  readonly acknowledge: () => SaveAcknowledgment;
  readonly runFollowUps: () => void;
}): SaveAcknowledgment {
  const result = input.acknowledge();
  if (
    result === "acknowledged" &&
    input.snapshotWorkspaceId === input.getBoundWorkspaceId()
  )
    input.runFollowUps();
  return result;
}

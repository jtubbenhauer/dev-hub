import type {
  WorkbenchGroupRect,
  WorkbenchGroupRef,
} from "@/lib/workbench/workbench-layout-api";
import type { WorkbenchGroupDirection } from "@/lib/workbench/workbench-shortcuts";

// Sashes and rounding can make neighbouring groups overlap by a pixel.
const EDGE_TOLERANCE_PX = 1;

function assertNever(value: never): never {
  throw new Error(`Unhandled group direction: ${String(value)}`);
}

function isOnSide(
  candidate: WorkbenchGroupRect,
  active: WorkbenchGroupRect,
  direction: WorkbenchGroupDirection,
): boolean {
  switch (direction) {
    case "right":
      return candidate.left >= active.left + active.width - EDGE_TOLERANCE_PX;
    case "left":
      return (
        candidate.left + candidate.width <= active.left + EDGE_TOLERANCE_PX
      );
    case "down":
      return candidate.top >= active.top + active.height - EDGE_TOLERANCE_PX;
    case "up":
      return candidate.top + candidate.height <= active.top + EDGE_TOLERANCE_PX;
    default:
      return assertNever(direction);
  }
}

function edgeGap(
  candidate: WorkbenchGroupRect,
  active: WorkbenchGroupRect,
  direction: WorkbenchGroupDirection,
): number {
  switch (direction) {
    case "right":
      return Math.max(0, candidate.left - (active.left + active.width));
    case "left":
      return Math.max(0, active.left - (candidate.left + candidate.width));
    case "down":
      return Math.max(0, candidate.top - (active.top + active.height));
    case "up":
      return Math.max(0, active.top - (candidate.top + candidate.height));
    default:
      return assertNever(direction);
  }
}

function perpendicularOverlap(
  candidate: WorkbenchGroupRect,
  active: WorkbenchGroupRect,
  direction: WorkbenchGroupDirection,
): number {
  const isHorizontalMove = direction === "left" || direction === "right";
  const [candidateStart, candidateSize, activeStart, activeSize] =
    isHorizontalMove
      ? [candidate.top, candidate.height, active.top, active.height]
      : [candidate.left, candidate.width, active.left, active.width];
  const overlapEnd = Math.min(
    candidateStart + candidateSize,
    activeStart + activeSize,
  );
  return Math.max(0, overlapEnd - Math.max(candidateStart, activeStart));
}

function centerDistance(
  candidate: WorkbenchGroupRect,
  active: WorkbenchGroupRect,
): number {
  const deltaX =
    candidate.left + candidate.width / 2 - (active.left + active.width / 2);
  const deltaY =
    candidate.top + candidate.height / 2 - (active.top + active.height / 2);
  return Math.hypot(deltaX, deltaY);
}

export function pickAdjacentGroup(
  groups: readonly WorkbenchGroupRef[],
  activeGroupId: string | null,
  direction: WorkbenchGroupDirection,
): WorkbenchGroupRef | null {
  const activeGroup = groups.find((group) => group.id === activeGroupId);
  if (!activeGroup) return null;
  const active = activeGroup.rect;
  const ranked = groups
    .filter((group) => group.id !== activeGroup.id)
    .filter((group) => isOnSide(group.rect, active, direction))
    .map((group) => ({
      group,
      gap: edgeGap(group.rect, active, direction),
      overlap: perpendicularOverlap(group.rect, active, direction),
      distance: centerDistance(group.rect, active),
    }))
    .sort(
      (a, b) =>
        a.gap - b.gap || b.overlap - a.overlap || a.distance - b.distance,
    );
  return ranked[0]?.group ?? null;
}

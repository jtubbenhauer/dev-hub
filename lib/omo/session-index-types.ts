import type { omoSessionIndex, OmoSessionKind } from "@/drizzle/schema";

export type OmoSessionIndexRow = typeof omoSessionIndex.$inferSelect;

export interface OmoSessionTouchRow {
  readonly durableId: string;
  readonly sessionPath: string | null;
  readonly title: string;
  readonly createdMs: number;
  readonly updatedMs: number;
  // Set when updatedMs was read from the transcript itself, so it may lower a
  // stored value that housekeeping writes pushed forward.
  readonly isUpdatedMsFromTranscript?: boolean;
}

export interface OmoSessionTouchMetadata {
  readonly title: string;
  readonly createdMs: number;
  readonly updatedMs: number;
}

export interface OmoAuthoritativeSessionRow extends OmoSessionTouchRow {
  readonly kind: OmoSessionKind;
  readonly context: unknown;
  readonly parentDurableId?: string | null;
  readonly agent?: string | null;
  readonly category?: string | null;
}

export interface OmoTaskEventSessionRow {
  readonly durableId: string;
  readonly parentDurableId?: string | null;
  readonly agent?: string | null;
  readonly category?: string | null;
  readonly title?: string;
  readonly createdMs?: number;
  readonly updatedMs?: number;
}

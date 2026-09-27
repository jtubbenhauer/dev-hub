import type { JsonlRecord } from "@/lib/omo/jsonl";
import type { Event } from "@/lib/opencode/types";

export interface Effect {
  readonly type: string;
  readonly [key: string]: unknown;
}

export interface LiveAdapterSeed {
  readonly lastUserMessageID?: string;
  readonly lastKnownModel?: string;
  readonly lastKnownProvider?: string;
}

export interface LiveAdapterOptions {
  readonly sessionId: string;
  readonly workspacePath: string;
  readonly skillPrefixes: readonly string[];
}

export interface LiveAdapterResult {
  readonly events: Event[];
  readonly effects: Effect[];
}

export interface LiveAdapter {
  readonly seed: (state: LiveAdapterSeed) => void;
  readonly handle: (record: JsonlRecord) => LiveAdapterResult;
}

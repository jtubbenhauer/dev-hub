import type { JsonlRecord } from "@/lib/omo/jsonl";
import type { Event } from "@/lib/opencode/types";

export type Effect =
  | {
      readonly type: string;
      readonly [key: string]: unknown;
    }
  | {
      readonly mergeFromTaskEvent: {
        readonly durableId: string;
        readonly workspaceId: string;
        readonly parentDurableId: string;
        readonly kind: string;
        readonly agent?: string;
        readonly category?: string;
        readonly title: string;
        readonly createdMs: number;
        readonly updatedMs: number;
      };
      readonly refreshIndex: true;
    };

export interface LiveAdapterSeed {
  readonly lastUserMessageID?: string;
  readonly lastKnownModel?: string;
  readonly lastKnownProvider?: string;
}

export interface LiveAdapterOptions {
  readonly sessionId: string;
  readonly workspaceId: string;
  readonly workspacePath: string;
  readonly skillPrefixes: readonly string[];
  readonly todoToolName?: string;
}

export interface LiveAdapterResult {
  readonly events: Event[];
  readonly effects: Effect[];
}

export interface LiveAdapter {
  readonly seed: (state: LiveAdapterSeed) => void;
  readonly handle: (record: JsonlRecord) => LiveAdapterResult;
}

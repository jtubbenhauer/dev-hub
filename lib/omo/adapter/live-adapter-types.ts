import type { OmoBackgroundStatusUpdate } from "@/lib/omo/adapter/background-status";
import type { JsonlRecord } from "@/lib/omo/jsonl";
import type {
  Event,
  SessionBackgroundMonitor,
  SubAgentActivity,
} from "@/lib/opencode/types";

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
    }
  | {
      readonly linkTaskChild: {
        readonly parentDurableId: string;
        readonly taskId: string;
        readonly title: string;
        readonly agent?: string;
        readonly category?: string;
        readonly updatedMs: number;
        readonly isActive: boolean;
        readonly activity?: SubAgentActivity;
      };
    }
  | {
      readonly backgroundStatus: OmoBackgroundStatusUpdate;
    }
  | {
      readonly monitorEntries: readonly SessionBackgroundMonitor[];
    };

export interface LiveAdapterSeed {
  readonly lastUserMessageID?: string;
  readonly lastKnownModel?: string;
  readonly lastKnownProvider?: string;
  readonly isStreaming?: boolean;
}

export interface LiveAdapterOptions {
  readonly sessionId: string;
  readonly workspaceId: string;
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
  readonly linkTaskChild: (taskId: string, childSessionId: string) => Event[];
}

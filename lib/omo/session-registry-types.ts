import type { Event } from "@/lib/opencode/types";
import type { DialogAdapter } from "@/lib/omo/adapter/dialogs";
import type { LiveAdapter } from "@/lib/omo/adapter/live-adapter-types";
import type { OmoSessionIndexRow } from "@/lib/omo/session-index";
import type { OmoRegistryRecordBuffer } from "@/lib/omo/session-registry-lock";
import type { OmoOpenedState } from "@/lib/omo/session-registry-records";

export type OmoSessionRegistryWorkspace = {
  readonly id: string;
  readonly path: string;
};

export type OmoAttachRequest = {
  readonly workspace: OmoSessionRegistryWorkspace;
  readonly durableId?: string;
  readonly sessionPath?: string;
};

export type OmoBindingState =
  | "hydrating"
  | "cutover"
  | "live"
  | "detached"
  | "replaced"
  | "closed";

export type OmoResyncRequiredEvent = {
  readonly type: "session.resync_required";
  readonly properties: { readonly sessionID: string };
};

export type OmoSessionMetadataMovedEvent = {
  readonly type: "session.metadata_moved";
  readonly properties: {
    readonly sessionID: string;
    readonly fromSessionID: string;
  };
};

export type OmoRegistryEvent =
  | Event
  | OmoResyncRequiredEvent
  | OmoSessionMetadataMovedEvent;
export type OmoRegistryEventSink = (event: OmoRegistryEvent) => void;

export interface OmoSessionBinding {
  readonly workspace: OmoSessionRegistryWorkspace;
  readonly workspaceId: string;
  readonly canonicalWorkspacePath: string;
  readonly durableId: string;
  readonly routingHandle: string;
  readonly sessionPath: string | null;
  readonly generation: number;
  readonly adapter: LiveAdapter;
  readonly dialogs: DialogAdapter;
  readonly openedState: OmoOpenedState;
  readonly ready: Promise<OmoSessionBinding>;
  readonly resolveReady: (binding: OmoSessionBinding) => void;
  readonly rejectReady: (error: unknown) => void;
  unregisterSession: () => void;
  buffer: OmoRegistryRecordBuffer;
  effectTail: Promise<void>;
  state: OmoBindingState;
  failure: Error | undefined;
}

export type OmoPendingAttach = {
  readonly promise: Promise<OmoSessionBinding>;
  readonly token: object;
};

export type OmoAttachAliases = {
  readonly token: object;
  readonly keys: Set<string>;
};

export type OmoCanonicalAttach = {
  readonly rawId: string | undefined;
  readonly sessionPath: string | null;
  readonly row: OmoSessionIndexRow | null;
};

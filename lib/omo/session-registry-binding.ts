import { createLiveAdapter } from "@/lib/omo/adapter/live-events";
import type { JsonlRecord } from "@/lib/omo/jsonl";
import type { OmoOpenedSession } from "@/lib/omo/rpc-client";
import { OmoRegistryRecordBuffer } from "@/lib/omo/session-registry-lock";
import { createOmoBindingReady } from "@/lib/omo/session-registry-ready";
import type { OmoOpenedState } from "@/lib/omo/session-registry-records";
import type {
  OmoAttachRequest,
  OmoSessionBinding,
} from "@/lib/omo/session-registry-types";

export type OmoBindOpenedInput = {
  readonly opened: OmoOpenedSession;
  readonly buffered: readonly JsonlRecord[];
  readonly overflowed: boolean;
  readonly request: OmoAttachRequest;
  readonly canonicalPath: string;
};

type OmoOpenedBindingInput = {
  readonly openedState: OmoOpenedState;
  readonly routingHandle: string;
  readonly buffered: readonly JsonlRecord[];
  readonly overflowed: boolean;
  readonly request: OmoAttachRequest;
  readonly canonicalPath: string;
  readonly generation: number;
};

type OmoSuccessorBindingInput = {
  readonly previous: OmoSessionBinding;
  readonly durableId: string;
  readonly sessionPath: string;
  readonly generation: number;
};

function createRegistryLiveAdapter(
  sessionId: string,
  workspaceId: string,
  workspacePath: string,
) {
  const options = {
    sessionId,
    workspaceId,
    workspacePath,
    skillPrefixes: [],
  };
  return createLiveAdapter(options);
}

export function createOmoOpenedBinding(
  input: OmoOpenedBindingInput,
): OmoSessionBinding {
  const { openedState, request } = input;
  const sessionPath = openedState.sessionPath ?? request.sessionPath ?? null;
  const binding: OmoSessionBinding = {
    workspace: request.workspace,
    workspaceId: request.workspace.id,
    canonicalWorkspacePath: input.canonicalPath,
    durableId: openedState.durableId,
    routingHandle: input.routingHandle,
    sessionPath,
    generation: input.generation,
    adapter: createRegistryLiveAdapter(
      `omo_${openedState.durableId}`,
      request.workspace.id,
      request.workspace.path,
    ),
    openedState,
    ...createOmoBindingReady(),
    unregisterSession: () => undefined,
    buffer: new OmoRegistryRecordBuffer(),
    effectTail: Promise.resolve(),
    state: "hydrating",
    failure: undefined,
  };
  binding.buffer.pushAll(input.buffered);
  if (input.overflowed) binding.buffer.overflowed = true;
  return binding;
}

export function createOmoSuccessorBinding(
  input: OmoSuccessorBindingInput,
): OmoSessionBinding {
  const { previous, durableId, sessionPath } = input;
  return {
    ...previous,
    durableId,
    sessionPath,
    generation: input.generation,
    adapter: createRegistryLiveAdapter(
      `omo_${durableId}`,
      previous.workspaceId,
      previous.workspace.path,
    ),
    openedState: {
      ...previous.openedState,
      durableId,
      sessionPath,
      isStreaming: false,
      record: {
        sessionId: durableId,
        sessionFile: sessionPath,
        isStreaming: false,
      },
    },
    ...createOmoBindingReady(),
    unregisterSession: previous.unregisterSession,
    buffer: previous.buffer,
    effectTail: previous.effectTail,
    state: "hydrating",
    failure: undefined,
  };
}

import {
  createDialogAdapter,
  type DialogAdapter,
} from "@/lib/omo/adapter/dialogs";
import { createLiveAdapter } from "@/lib/omo/adapter/live-events";
import type { DialogLedger } from "@/lib/omo/dialog-ledger";
import type { JsonlRecord } from "@/lib/omo/jsonl";
import type { OmoOpenedSession, OmoRpcClient } from "@/lib/omo/rpc-client";
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
  readonly client: OmoRpcClient;
  readonly dialogLedger: DialogLedger;
  readonly skillPrefixes: readonly string[];
};

type OmoSuccessorBindingInput = {
  readonly previous: OmoSessionBinding;
  readonly durableId: string;
  readonly sessionPath: string;
  readonly generation: number;
  readonly client: OmoRpcClient;
  readonly dialogLedger: DialogLedger;
  readonly skillPrefixes: readonly string[];
};

function createRegistryLiveAdapter(
  sessionId: string,
  workspaceId: string,
  workspacePath: string,
  skillPrefixes: readonly string[],
) {
  return createLiveAdapter({
    sessionId,
    workspaceId,
    workspacePath,
    skillPrefixes,
  });
}

function createRegistryDialogAdapter(
  client: OmoRpcClient,
  ledger: DialogLedger,
  routingHandle: string,
  durableId: string,
  workspaceId: string,
): DialogAdapter {
  return createDialogAdapter({
    ledger,
    routingHandle,
    durableId,
    workspaceId,
    sendResponse: (record) => {
      client.sendFireAndForget(record);
      return Promise.resolve();
    },
  });
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
      input.skillPrefixes,
    ),
    dialogs: createRegistryDialogAdapter(
      input.client,
      input.dialogLedger,
      input.routingHandle,
      openedState.durableId,
      request.workspace.id,
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
      input.skillPrefixes,
    ),
    dialogs: createRegistryDialogAdapter(
      input.client,
      input.dialogLedger,
      previous.routingHandle,
      durableId,
      previous.workspaceId,
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

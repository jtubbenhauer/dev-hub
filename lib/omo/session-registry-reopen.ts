import { OmoCommandError } from "@/lib/omo/errors";
import type { JsonlRecord } from "@/lib/omo/jsonl";
import type { OmoSessionRegistry } from "@/lib/omo/session-registry-core";
import { OmoEngineUnavailableError } from "@/lib/omo/session-registry-errors";
import { isJsonObject } from "@/lib/omo/session-registry-records";
import type { OmoSessionBinding } from "@/lib/omo/session-registry-types";

const MAX_PATH_IN_USE_RETRIES = 5;
const DEFAULT_PATH_IN_USE_RETRY_MS = 2_000;

export type OmoSessionRegistryOptions = {
  readonly getSubscriberCount?: (workspaceId: string) => number;
};

type OmoLifecycleRecordInput = {
  readonly registry: OmoSessionRegistry;
  readonly binding: OmoSessionBinding | undefined;
  readonly record: JsonlRecord;
  readonly getSubscriberCount: (workspaceId: string) => number;
};

type UnknownSessionRecovery = "retry" | "reopen" | "none";

function recoveryForCommand(command: string): UnknownSessionRecovery {
  switch (command) {
    case "get_state":
    case "get_entries":
    case "get_messages":
    case "set_model":
    case "set_thinking_level":
    case "set_session_name":
    case "abort":
      return "retry";
    case "prompt":
    case "steer":
    case "compact":
    case "navigate_tree":
    case "fork":
      return "reopen";
    default:
      return "none";
  }
}

function retryAfterMs(error: OmoCommandError): number {
  const data = error.errorData;
  if (!isJsonObject(data)) return DEFAULT_PATH_IN_USE_RETRY_MS;
  const retryAfter = data["retry_after_ms"];
  return typeof retryAfter === "number" &&
    Number.isFinite(retryAfter) &&
    retryAfter >= 0
    ? retryAfter
    : DEFAULT_PATH_IN_USE_RETRY_MS;
}

function wait(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function reopenOmoBinding(
  registry: OmoSessionRegistry,
  binding: OmoSessionBinding,
): Promise<OmoSessionBinding> {
  if (binding.sessionPath === null) {
    throw new OmoEngineUnavailableError(
      "open_session",
      "The detached OmO session has no durable path",
    );
  }
  registry.detachBinding(binding);
  return registry.attach({
    workspace: binding.workspace,
    durableId: binding.durableId,
    sessionPath: binding.sessionPath,
  });
}

function sendBoundCommand(
  registry: OmoSessionRegistry,
  binding: OmoSessionBinding,
  command: JsonlRecord,
): Promise<JsonlRecord> {
  return registry.client.request({
    ...command,
    sessionId: binding.routingHandle,
  });
}

function isUnknownSession(error: unknown): error is OmoCommandError {
  return (
    error instanceof OmoCommandError && error.errorCode === "unknown_session"
  );
}

function reattachSubscribedBindings(
  registry: OmoSessionRegistry,
  getSubscriberCount: (workspaceId: string) => number,
): void {
  for (const binding of registry.bindingsForLifecycle()) {
    if (
      binding.state !== "detached" ||
      binding.sessionPath === null ||
      getSubscriberCount(binding.workspaceId) <= 0
    ) {
      continue;
    }
    void registry
      .attach({
        workspace: binding.workspace,
        durableId: binding.durableId,
        sessionPath: binding.sessionPath,
      })
      .catch((error: unknown) => {
        binding.failure =
          error instanceof Error ? error : new Error(String(error));
      });
  }
}

export async function openOmoSessionWithPathRetry<T>(
  open: () => Promise<T>,
): Promise<T> {
  for (let retryCount = 0; ; retryCount += 1) {
    try {
      return await open();
    } catch (error) {
      if (
        !(error instanceof OmoCommandError) ||
        error.errorCode !== "session_path_in_use" ||
        retryCount >= MAX_PATH_IN_USE_RETRIES
      ) {
        throw error;
      }
      await wait(retryAfterMs(error));
    }
  }
}

export async function requestOmoSession(
  registry: OmoSessionRegistry,
  binding: OmoSessionBinding,
  command: JsonlRecord,
): Promise<JsonlRecord> {
  const commandType = command["type"];
  if (typeof commandType !== "string") {
    throw new TypeError("OmO session command requires a type");
  }
  const activeBinding =
    binding.state === "detached"
      ? await reopenOmoBinding(registry, binding)
      : binding;
  try {
    return await sendBoundCommand(registry, activeBinding, command);
  } catch (error) {
    if (!isUnknownSession(error)) throw error;
    const recovery = recoveryForCommand(commandType);
    if (recovery === "none") throw error;
    const reopened = await reopenOmoBinding(registry, activeBinding);
    if (recovery === "retry") {
      return sendBoundCommand(registry, reopened, command);
    }
    throw new OmoEngineUnavailableError(commandType, error.message);
  }
}

export function handleOmoLifecycleRecord(
  input: OmoLifecycleRecordInput,
): boolean {
  const { registry, binding, record, getSubscriberCount } = input;
  const type = record["type"];
  if (type === "__devhub_disconnected") {
    for (const candidate of registry.bindingsForLifecycle()) {
      registry.detachBinding(candidate);
    }
    return true;
  }
  if (type === "__devhub_connected") {
    reattachSubscribedBindings(registry, getSubscriberCount);
    return true;
  }
  if (type === "host_memory_pressure") {
    const details = Object.fromEntries(
      Object.entries(record).filter(([key]) => key !== "type"),
    );
    console.warn("OmO host memory pressure", details);
    return true;
  }
  if (binding === undefined) return false;
  if (type === "session_parked") {
    registry.detachBinding(binding);
    return true;
  }
  if (
    type === "session_closed" &&
    (record["reason"] === "handoff_parked" ||
      record["reason"] === "idle_evicted")
  ) {
    registry.detachBinding(binding);
    return true;
  }
  return false;
}

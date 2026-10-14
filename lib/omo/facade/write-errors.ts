import {
  isOmoTransportErrnoError,
  OmoCommandError,
  OmoDaemonNotRunningError,
  OmoEngineRefusedError,
  OmoTransportGoneError,
} from "@/lib/omo/errors";
import { jsonResponse } from "@/lib/omo/facade/write-types";
import { OmoSessionIdentityConflictError } from "@/lib/omo/session-index-errors";
import {
  OmoCorruptIndexRowError,
  OmoEngineUnavailableError,
  OmoHydrationOverflowError,
  OmoSessionReplacedError,
  OmoWorkspacePathConflictError,
} from "@/lib/omo/session-registry-errors";
import { isJsonObject } from "@/lib/omo/session-registry-records";
import { OmoNotFoundError } from "@/lib/omo/session-source";

function isNamedError(error: unknown, name: string): error is Error {
  return error instanceof Error && error.name === name;
}

function errorRecord(error: Error): Readonly<Record<string, unknown>> {
  return isJsonObject(error) ? error : {};
}

function retryAfterSeconds(errorData: unknown): string {
  if (!isJsonObject(errorData)) return "1";
  const retryAfterMs = errorData["retry_after_ms"];
  return String(
    Math.max(
      1,
      Math.ceil(
        typeof retryAfterMs === "number" && Number.isFinite(retryAfterMs)
          ? retryAfterMs / 1_000
          : 1,
      ),
    ),
  );
}

function isCommandError(error: unknown): error is Error {
  return (
    error instanceof OmoCommandError || isNamedError(error, "OmoCommandError")
  );
}

function unknownCommandMessage(errorData: unknown): string | undefined {
  if (!isJsonObject(errorData) || typeof errorData["command"] !== "string") {
    return undefined;
  }
  const command = errorData["command"];
  if (errorData["reason"] === "interactive_only") {
    return `/${command} only works in the omo terminal. The message wasn't sent.`;
  }
  const rawSuggestions = errorData["suggestions"];
  const suggestions = Array.isArray(rawSuggestions)
    ? rawSuggestions.filter(
        (suggestion): suggestion is string => typeof suggestion === "string",
      )
    : [];
  const didYouMean =
    suggestions.length === 0
      ? ""
      : ` Did you mean ${suggestions.map((name) => `/${name}`).join(", ")}?`;
  return `Unknown command /${command}.${didYouMean} The message wasn't sent.`;
}

function commandFailureMessage(error: Error): string {
  const record = errorRecord(error);
  if (record["errorCode"] === "unknown_command") {
    const message = unknownCommandMessage(record["errorData"]);
    if (message !== undefined) return message;
  }
  const message = record["error"];
  return typeof message === "string" ? message : error.message;
}

export function lateOmoFailureMessage(error: unknown): string {
  if (isCommandError(error)) return commandFailureMessage(error);
  return "omo didn't confirm the request in time. It may still go through, so check the session before you try again.";
}

function commandErrorResponse(error: Error): Response | null {
  if (!isCommandError(error)) return null;
  const record = errorRecord(error);
  const errorCode = record["errorCode"];
  if (errorCode === "host_draining" || errorCode === "host_stopping") {
    return jsonResponse(
      { error: "engine_unavailable" },
      { status: 503, headers: { "Retry-After": "2" } },
    );
  }
  if (errorCode === "host_memory_pressure") {
    return jsonResponse(
      { error: "engine_pressure" },
      {
        status: 503,
        headers: {
          "Retry-After": retryAfterSeconds(record["errorData"]),
        },
      },
    );
  }
  return jsonResponse(
    {
      error: commandFailureMessage(error),
      ...(typeof errorCode === "string" ? { errorCode } : {}),
    },
    { status: 422 },
  );
}

export function responseForOmoWriteError(error: unknown): Response | null {
  if (
    error instanceof OmoNotFoundError ||
    isNamedError(error, "OmoNotFoundError")
  ) {
    return jsonResponse({ error: "session_not_found" }, { status: 404 });
  }
  if (
    error instanceof OmoSessionIdentityConflictError ||
    isNamedError(error, "OmoSessionIdentityConflictError") ||
    error instanceof OmoWorkspacePathConflictError ||
    isNamedError(error, "OmoWorkspacePathConflictError")
  ) {
    return jsonResponse({ error: "identity_conflict" }, { status: 409 });
  }
  if (
    error instanceof OmoCorruptIndexRowError ||
    isNamedError(error, "OmoCorruptIndexRowError")
  ) {
    return jsonResponse({ error: "corrupt_session_index" }, { status: 409 });
  }
  if (
    error instanceof OmoHydrationOverflowError ||
    isNamedError(error, "OmoHydrationOverflowError")
  ) {
    return jsonResponse({ error: "engine_unavailable" }, { status: 503 });
  }
  if (
    error instanceof OmoEngineUnavailableError ||
    error instanceof OmoDaemonNotRunningError ||
    error instanceof OmoTransportGoneError ||
    error instanceof OmoEngineRefusedError ||
    isNamedError(error, "OmoEngineUnavailableError") ||
    isNamedError(error, "OmoDaemonNotRunningError") ||
    isNamedError(error, "OmoTransportGoneError") ||
    isNamedError(error, "OmoEngineRefusedError") ||
    isOmoTransportErrnoError(error)
  ) {
    return jsonResponse({ error: "engine_unavailable" }, { status: 503 });
  }
  if (error instanceof OmoSessionReplacedError) return null;
  if (error instanceof Error) return commandErrorResponse(error);
  return null;
}

export function replacementId(error: unknown): string | null {
  if (
    !(error instanceof OmoSessionReplacedError) &&
    !isNamedError(error, "OmoSessionReplacedError")
  ) {
    return null;
  }
  const newDurableId = errorRecord(error)["newDurableId"];
  return typeof newDurableId === "string" ? newDurableId : null;
}

export function replacementConflictResponse(rawId: string): Response {
  return jsonResponse(
    { error: "session_replaced" },
    {
      status: 409,
      headers: { "X-Omo-Session-Replaced": `omo_${rawId}` },
    },
  );
}

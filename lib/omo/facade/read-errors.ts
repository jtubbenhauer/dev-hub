import { OmoCommandError, OmoTransportGoneError } from "@/lib/omo/errors";
import {
  OmoCorruptIndexRowError,
  OmoEngineUnavailableError,
  OmoSessionReplacedError,
  OmoWorkspacePathConflictError,
} from "@/lib/omo/session-registry-errors";
import { jsonResponse } from "@/lib/omo/facade/read-types";

function hasErrorName(error: unknown, name: string): error is Error {
  return error instanceof Error && error.name === name;
}

function stringProperty(error: Error, key: string): string | undefined {
  if (!(key in error)) return undefined;
  const value = error[key as keyof Error];
  return typeof value === "string" ? value : undefined;
}

function numberProperty(error: Error, key: string): number | undefined {
  if (!(key in error)) return undefined;
  const value = error[key as keyof Error];
  return typeof value === "number" ? value : undefined;
}

export function replacementId(error: unknown): string | undefined {
  if (
    !(error instanceof OmoSessionReplacedError) &&
    !hasErrorName(error, "OmoSessionReplacedError")
  ) {
    return undefined;
  }
  return stringProperty(error, "newDurableId");
}

export function isHistoryFallbackError(error: unknown): boolean {
  return (
    error instanceof OmoTransportGoneError ||
    error instanceof OmoEngineUnavailableError ||
    error instanceof OmoCorruptIndexRowError ||
    hasErrorName(error, "OmoTransportGoneError") ||
    hasErrorName(error, "OmoEngineUnavailableError") ||
    hasErrorName(error, "OmoCorruptIndexRowError") ||
    (error instanceof Error && numberProperty(error, "statusCode") === 503)
  );
}

export function isEngineUnavailableError(error: unknown): boolean {
  return (
    isHistoryFallbackError(error) &&
    !(
      error instanceof OmoCorruptIndexRowError ||
      hasErrorName(error, "OmoCorruptIndexRowError")
    )
  );
}

function commandErrorResponse(error: OmoCommandError): Response | null {
  if (error.errorCode === "host_memory_pressure") {
    const retryAfterMs =
      typeof error.errorData === "object" &&
      error.errorData !== null &&
      "retry_after_ms" in error.errorData &&
      typeof error.errorData.retry_after_ms === "number"
        ? error.errorData.retry_after_ms
        : 1_000;
    return jsonResponse(
      { error: "engine_pressure" },
      {
        status: 503,
        headers: {
          "Retry-After": String(Math.max(1, Math.ceil(retryAfterMs / 1_000))),
        },
      },
    );
  }
  if (error.errorCode === "host_draining") {
    return jsonResponse(
      { error: "engine_unavailable" },
      { status: 503, headers: { "Retry-After": "2" } },
    );
  }
  return null;
}

export function responseForOmoReadError(error: unknown): Response | null {
  const replacedBy = replacementId(error);
  if (replacedBy !== undefined) {
    return jsonResponse(
      { error: "session_replaced" },
      {
        status: 409,
        headers: { "X-Omo-Session-Replaced": `omo_${replacedBy}` },
      },
    );
  }
  if (
    error instanceof OmoWorkspacePathConflictError ||
    hasErrorName(error, "OmoWorkspacePathConflictError")
  ) {
    return jsonResponse({ error: "workspace_path_conflict" }, { status: 409 });
  }
  if (
    error instanceof OmoCorruptIndexRowError ||
    hasErrorName(error, "OmoCorruptIndexRowError")
  ) {
    return jsonResponse({ error: "index_corrupt" }, { status: 409 });
  }
  if (error instanceof OmoCommandError) {
    const response = commandErrorResponse(error);
    if (response !== null) return response;
  }
  if (isEngineUnavailableError(error)) {
    return jsonResponse({ error: "engine_unavailable" }, { status: 503 });
  }
  if (hasErrorName(error, "OmoNotFoundError")) {
    return jsonResponse({ error: "session_not_found" }, { status: 404 });
  }
  return null;
}

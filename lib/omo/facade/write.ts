import {
  abortOmoSession,
  answerOmoQuestion,
  commandOmoSession,
  forkOmoSession,
  summarizeOmoSession,
} from "@/lib/omo/facade/write-actions";
import {
  replacementConflictResponse,
  replacementId,
  responseForOmoWriteError,
} from "@/lib/omo/facade/write-errors";
import { promptOmoSession } from "@/lib/omo/facade/write-prompt";
import { revertOmoSession } from "@/lib/omo/facade/write-revert";
import { createOmoWriteContext } from "@/lib/omo/facade/write-runtime";
import { ensureOmoConnectionIfNeeded } from "@/lib/omo/runtime";
import {
  createOmoSession,
  deleteOmoSession,
  renameOmoSession,
} from "@/lib/omo/facade/write-session";
import type {
  OmoWriteContext,
  OmoWriteRequest,
} from "@/lib/omo/facade/write-types";
import { unsupportedResponse } from "@/lib/omo/facade/write-types";

export type { OmoWriteRequest } from "@/lib/omo/facade/write-types";

const SESSION_ACTIONS = [
  "prompt_async",
  "abort",
  "command",
  "summarize",
  "revert",
  "fork",
] as const;

type SessionAction = (typeof SESSION_ACTIONS)[number];

function normalizedPath(path: string): string {
  if (path === "/") return path;
  return path.endsWith("/") ? path.slice(0, -1) : path;
}

function parsePublicId(publicId: string): string | null {
  if (!publicId.startsWith("omo_")) return null;
  let rawId: string;
  try {
    rawId = decodeURIComponent(publicId.slice("omo_".length));
  } catch (error) {
    if (error instanceof URIError) return null;
    throw error;
  }
  if (
    rawId.length === 0 ||
    rawId === "." ||
    rawId === ".." ||
    rawId.includes("/") ||
    rawId.includes("\\") ||
    rawId.includes("\0")
  ) {
    return null;
  }
  return rawId;
}

function isSessionAction(value: string | undefined): value is SessionAction {
  return (
    value !== undefined && SESSION_ACTIONS.some((action) => action === value)
  );
}

async function routeSessionAction(
  context: OmoWriteContext,
  request: OmoWriteRequest,
  rawId: string,
  action: SessionAction,
): Promise<Response> {
  switch (action) {
    case "prompt_async":
      return promptOmoSession(context, rawId, request.body);
    case "abort":
      return abortOmoSession(context, rawId);
    case "command":
      return commandOmoSession(context, rawId, request.body);
    case "summarize":
      return summarizeOmoSession(context, rawId);
    case "revert":
      return revertOmoSession(context, rawId, request.body);
    case "fork":
      return forkOmoSession(context, rawId, request.body);
    default: {
      const exhaustiveAction: never = action;
      throw new TypeError(`Unsupported session action: ${exhaustiveAction}`);
    }
  }
}

async function withOneReplacementRetry(
  rawId: string,
  operation: (currentRawId: string) => Promise<Response>,
): Promise<Response> {
  try {
    return await operation(rawId);
  } catch (error) {
    const successorId = replacementId(error);
    if (successorId === null) throw error;
    try {
      const response = await operation(successorId);
      response.headers.set("X-Omo-Session-Replaced", `omo_${successorId}`);
      return response;
    } catch (retryError) {
      const secondSuccessorId = replacementId(retryError);
      if (secondSuccessorId !== null) {
        return replacementConflictResponse(secondSuccessorId);
      }
      throw retryError;
    }
  }
}

async function routeSessionWrite(
  context: OmoWriteContext,
  request: OmoWriteRequest,
  path: string,
): Promise<Response> {
  if (path === "/session") {
    return request.method === "POST"
      ? createOmoSession(context)
      : unsupportedResponse();
  }
  const match =
    /^\/session\/([^/]+)(?:\/(prompt_async|abort|command|summarize|revert|fork))?$/.exec(
      path,
    );
  if (match === null) return unsupportedResponse();
  const publicId = match[1];
  const rawId = publicId === undefined ? null : parsePublicId(publicId);
  if (rawId === null) return unsupportedResponse();
  const action = match[2];
  if (action !== undefined) {
    if (request.method !== "POST" || !isSessionAction(action)) {
      return unsupportedResponse();
    }
    return withOneReplacementRetry(rawId, (currentRawId) =>
      routeSessionAction(context, request, currentRawId, action),
    );
  }
  if (request.method === "DELETE") {
    return withOneReplacementRetry(rawId, (currentRawId) =>
      deleteOmoSession(context, currentRawId),
    );
  }
  if (request.method === "PATCH") {
    return withOneReplacementRetry(rawId, (currentRawId) =>
      renameOmoSession(context, currentRawId, request.body),
    );
  }
  return unsupportedResponse();
}

async function routeOmoWrite(request: OmoWriteRequest): Promise<Response> {
  const context = createOmoWriteContext(request.workspace);
  await ensureOmoConnectionIfNeeded(request.workspace, context.runtime);
  const path = normalizedPath(request.path);
  const question = /^\/question\/([^/]+)\/(reply|reject)$/.exec(path);
  if (question !== null) {
    const publicId = question[1];
    const action = question[2];
    if (
      request.method !== "POST" ||
      publicId === undefined ||
      (action !== "reply" && action !== "reject")
    ) {
      return unsupportedResponse();
    }
    return answerOmoQuestion(context, {
      publicId,
      action,
      body: request.body,
    });
  }
  return routeSessionWrite(context, request, path);
}

export async function handleOmoWrite(
  request: OmoWriteRequest,
): Promise<Response> {
  try {
    return await routeOmoWrite(request);
  } catch (error) {
    const response = responseForOmoWriteError(error);
    if (response !== null) return response;
    throw error;
  }
}

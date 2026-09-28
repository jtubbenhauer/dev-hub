import type { DialogLedger } from "@/lib/omo/dialog-ledger";
import type { OmoReadWorkspace } from "@/lib/omo/facade/read-types";
import type { OmoRuntime } from "@/lib/omo/session-registry";
import type { SessionSource } from "@/lib/omo/session-source";

export type OmoWriteRequest = {
  readonly method: string;
  readonly path: string;
  readonly workspace: OmoReadWorkspace;
  readonly userId: string;
  readonly body: unknown;
};

export type OmoWriteContext = {
  readonly runtime: OmoRuntime;
  readonly source: SessionSource;
  readonly dialogs: DialogLedger;
  readonly workspace: OmoReadWorkspace;
};

export function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return Response.json(body, init);
}

export function noContentResponse(headers?: HeadersInit): Response {
  return new Response(null, { status: 204, headers });
}

export function invalidRequestResponse(): Response {
  return jsonResponse({ error: "invalid_request" }, { status: 400 });
}

export function sessionNotFoundResponse(): Response {
  return jsonResponse({ error: "session_not_found" }, { status: 404 });
}

export function unsupportedResponse(): Response {
  return jsonResponse({ error: "unsupported_for_engine" }, { status: 404 });
}

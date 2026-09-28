import type { OmoRuntime } from "@/lib/omo/session-registry";
import type { SessionSource } from "@/lib/omo/session-source";

export type OmoReadWorkspace = {
  readonly id: string;
  readonly path: string;
  readonly backend?: "local" | "remote";
  readonly agentUrl?: string | null;
};

export type OmoReadRequest = {
  readonly method: string;
  readonly path: string;
  readonly query: URLSearchParams;
  readonly workspace: OmoReadWorkspace;
  readonly userId: string;
};

export type OmoReadContext = {
  readonly runtime: OmoRuntime;
  readonly source: SessionSource;
  readonly workspace: OmoReadWorkspace;
};

export function jsonResponse(value: unknown, init?: ResponseInit): Response {
  return Response.json(value, init);
}

export function unsupportedResponse(): Response {
  return jsonResponse({ error: "unsupported_for_engine" }, { status: 404 });
}

export function sessionNotFoundResponse(): Response {
  return jsonResponse({ error: "session_not_found" }, { status: 404 });
}

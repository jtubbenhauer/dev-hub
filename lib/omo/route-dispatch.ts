import { ensureOmoDaemon } from "@/lib/omo/daemon";
import { handleOmoRead } from "@/lib/omo/facade/read";
import { getOmoReadRuntime } from "@/lib/omo/facade/read-runtime";
import type { OmoReadWorkspace } from "@/lib/omo/facade/read-types";
import { handleOmoWrite } from "@/lib/omo/facade/write";
import {
  OpenCodeTargetError,
  resolveOmoWorkspace,
} from "@/lib/opencode/proxy-target";
import type { Workspace } from "@/types";

export type OmoProxyRequest = {
  readonly request: Request;
  readonly userId: string;
  readonly workspaceId: string;
  readonly pathSegments: readonly string[];
};

export function toOmoWorkspace(workspace: Workspace): OmoReadWorkspace {
  return {
    id: workspace.id,
    path: workspace.path,
    backend: workspace.backend,
    agentUrl: workspace.agentUrl,
  };
}

export function targetErrorResponse(error: OpenCodeTargetError): Response {
  return Response.json(
    error.detail
      ? { error: error.message, detail: error.detail }
      : { error: error.message },
    { status: error.status },
  );
}

export function omoSessionNotFoundResponse(): Response {
  return Response.json({ error: "Session not found" }, { status: 404 });
}

export async function resolveOmoWorkspaceOrResponse(
  userId: string,
  workspaceId: string,
): Promise<Workspace | Response> {
  try {
    return await resolveOmoWorkspace(userId, workspaceId);
  } catch (error) {
    if (error instanceof OpenCodeTargetError) return targetErrorResponse(error);
    throw error;
  }
}

async function readJsonBody(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text.length === 0) return undefined;
  return JSON.parse(text);
}

export async function proxyOmoRequest(
  input: OmoProxyRequest,
): Promise<Response> {
  const { request, userId, workspaceId, pathSegments } = input;
  const resolved = await resolveOmoWorkspaceOrResponse(userId, workspaceId);
  if (resolved instanceof Response) return resolved;
  if (pathSegments[0] === "session" && pathSegments[1]?.startsWith("ses_")) {
    return omoSessionNotFoundResponse();
  }

  const workspace = toOmoWorkspace(resolved);
  const path = "/" + pathSegments.join("/");
  if (request.method === "GET") {
    const query = new URLSearchParams(new URL(request.url).searchParams);
    query.delete("workspaceId");
    return handleOmoRead({ method: "GET", path, query, workspace, userId });
  }

  let body: unknown;
  try {
    body = await readJsonBody(request);
  } catch (error) {
    if (error instanceof SyntaxError) {
      return Response.json({ error: "invalid_request" }, { status: 400 });
    }
    throw error;
  }
  return handleOmoWrite({
    method: request.method,
    path,
    workspace,
    userId,
    body,
  });
}

export async function restartOmoEngine(
  userId: string,
  workspaceId: string | null,
): Promise<Response> {
  if (workspaceId) {
    const resolved = await resolveOmoWorkspaceOrResponse(userId, workspaceId);
    if (resolved instanceof Response) return resolved;
  }
  try {
    await ensureOmoDaemon();
    await getOmoReadRuntime().client.reconnect();
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    return Response.json(
      { error: "engine_unavailable", detail: error.message },
      { status: 503, headers: { "Retry-After": "2" } },
    );
  }
  return Response.json({ restarted: true, target: "omo" });
}

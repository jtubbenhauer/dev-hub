import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import {
  resolveOpenCodeTarget,
  authorizeOpenCodeSession,
  OpenCodeTargetError,
} from "@/lib/opencode/proxy-target";
import { fetchWithHeaderTimeout } from "@/lib/opencode/fetch-timeout";
import { resolveWorkspaceEngine } from "@/lib/engine/resolve-engine";
import { requestRemoteOmoDaemon } from "@/lib/omo/remote-daemon";
import {
  proxyOmoRequest,
  resolveOmoWorkspaceOrResponse,
} from "@/lib/omo/route-dispatch";
import {
  OPEN_CODE_AUTO_SUSPEND_RETRY_DELAYS_MS,
  retryAutoSuspendRequest,
} from "@/lib/workspaces/auto-suspend-retry";
import type { Workspace } from "@/types";

interface RouteParams {
  params: Promise<{ path: string[] }>;
}

async function proxyToOpenCode(
  request: NextRequest,
  { params }: RouteParams,
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const pathSegments = await params;
  const opencodePath = "/" + pathSegments.path.join("/");

  const url = new URL(request.url);
  const workspaceId = url.searchParams.get("workspaceId");
  const requestedSessionId = pathSegments.path[1];
  if (!workspaceId) {
    return NextResponse.json(
      { error: "workspaceId is required" },
      { status: 400 },
    );
  }

  const engine = await resolveWorkspaceEngine(session.user.id, workspaceId);
  if (engine === "omo") {
    if (opencodePath === "/global/health") {
      const resolved = await resolveOmoWorkspaceOrResponse(
        session.user.id,
        workspaceId,
      );
      if (resolved instanceof Response) return resolved;
      if (resolved.backend === "remote") {
        try {
          const statusResponse = await requestRemoteOmoDaemon({
            workspace: resolved,
            userId: session.user.id,
            operation: "status",
          });
          if (!statusResponse.ok) {
            return NextResponse.json({ healthy: false }, { status: 503 });
          }
          const status: unknown = await statusResponse.json();
          const isHealthy =
            typeof status === "object" &&
            status !== null &&
            "reachable" in status &&
            status.reachable === true;
          return NextResponse.json(
            { healthy: isHealthy },
            { status: isHealthy ? 200 : 503 },
          );
        } catch {
          return NextResponse.json({ healthy: false }, { status: 503 });
        }
      }
    }
    return proxyOmoRequest({
      request,
      userId: session.user.id,
      workspaceId,
      pathSegments: pathSegments.path,
    });
  }
  if (
    pathSegments.path[0] === "session" &&
    requestedSessionId?.startsWith("omo_")
  ) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  let serverUrl: string;
  let directory: string | undefined;
  let workspace: Workspace | null = null;
  try {
    const target = await resolveOpenCodeTarget(session.user.id, workspaceId);
    serverUrl = target.serverUrl;
    directory = target.directory;
    workspace = target.workspace;
    const sessionId = requestedSessionId;
    if (pathSegments.path[0] === "session" && sessionId?.startsWith("ses_")) {
      await authorizeOpenCodeSession(target, sessionId);
    }
  } catch (error) {
    if (error instanceof OpenCodeTargetError) {
      return NextResponse.json(
        error.detail
          ? { error: error.message, detail: error.detail }
          : { error: error.message },
        { status: error.status },
      );
    }
    throw error;
  }

  const targetUrl = new URL(opencodePath, serverUrl);

  // Forward all query params except workspaceId, and inject directory
  url.searchParams.forEach((value, key) => {
    if (key !== "workspaceId") {
      targetUrl.searchParams.set(key, value);
    }
  });
  if (directory) {
    targetUrl.searchParams.set("directory", directory);
  }

  const headers = new Headers();
  const contentType = request.headers.get("content-type");
  if (contentType) {
    headers.set("content-type", contentType);
  }
  const accept = request.headers.get("accept");
  if (accept) {
    headers.set("accept", accept);
  }

  const isSSE =
    accept?.includes("text/event-stream") ||
    opencodePath === "/event" ||
    opencodePath === "/global/event";

  const fetchOptions: RequestInit = {
    method: request.method,
    headers,
  };

  if (request.method !== "GET" && request.method !== "HEAD" && contentType) {
    fetchOptions.body = await request.text();
  }

  try {
    const upstream = isSSE
      ? await fetch(targetUrl.toString(), fetchOptions)
      : await fetchWithHeaderTimeout(
          targetUrl.toString(),
          fetchOptions,
          15_000,
        );
    return proxyResponse(upstream, isSSE);
  } catch (error) {
    if (
      workspaceId &&
      workspace?.backend === "remote" &&
      !isSSE &&
      request.method !== "GET"
    ) {
      const retryResponse = await retryAutoSuspendRequest({
        workspace,
        userId: session.user.id,
        delaysMs: OPEN_CODE_AUTO_SUSPEND_RETRY_DELAYS_MS,
        request: () =>
          fetchWithHeaderTimeout(targetUrl.toString(), fetchOptions, 10_000),
      });
      if (retryResponse) return proxyResponse(retryResponse, false);
    }

    const isTimeout =
      error instanceof DOMException && error.name === "TimeoutError";
    const message =
      error instanceof Error ? error.message : "Proxy request failed";
    console.error(
      `[opencode-proxy] ${request.method} ${opencodePath} ${isTimeout ? "timed out" : "failed"}: ${message}`,
    );
    return NextResponse.json(
      { error: "OpenCode proxy error", detail: message },
      { status: isTimeout ? 504 : 502 },
    );
  }
}

export const GET = proxyToOpenCode;
export const POST = proxyToOpenCode;
export const PUT = proxyToOpenCode;
export const DELETE = proxyToOpenCode;
export const PATCH = proxyToOpenCode;

// SSE connections can be long-lived
export const maxDuration = 300;

async function proxyResponse(upstream: Response, isSSE: boolean) {
  if (isSSE && upstream.body) {
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      },
    });
  }

  // 204/304 are null-body statuses — Response constructor throws if given a body
  if (upstream.status === 204 || upstream.status === 304) {
    return new Response(null, { status: upstream.status });
  }

  const responseHeaders = new Headers();
  const upstreamContentType = upstream.headers.get("content-type");
  if (upstreamContentType) {
    responseHeaders.set("content-type", upstreamContentType);
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}

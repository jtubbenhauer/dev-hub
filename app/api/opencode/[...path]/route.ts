import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import {
  resolveOpenCodeTarget,
  resolveOmoWorkspace,
  authorizeOpenCodeSession,
  OpenCodeTargetError,
} from "@/lib/opencode/proxy-target";
import { fetchWithHeaderTimeout } from "@/lib/opencode/fetch-timeout";
import { resolveWorkspaceEngine } from "@/lib/engine/resolve-engine";
import { chooseRequestEngine } from "@/lib/engine/request-engine";
import type { ChatEngine } from "@/lib/engine/types";
import { canWorkspaceRunEngine } from "@/lib/engine/workspace-engines";
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

interface EngineProxyRequest {
  readonly request: NextRequest;
  readonly userId: string;
  readonly workspaceId: string;
  readonly pathSegments: readonly string[];
}

// The client aborts session lists after 10s; the second engine of a merged
// read must not hold the answer past that (for example a cold OpenCode start).
const SECONDARY_ENGINE_READ_BUDGET_MS = 8_000;

const DEV_HUB_QUERY_PARAMS = new Set(["workspaceId", "engine"]);

async function proxyToOmo(input: EngineProxyRequest): Promise<Response> {
  const { request, userId, workspaceId, pathSegments } = input;
  if (pathSegments.join("/") === "global/health") {
    const resolved = await resolveOmoWorkspaceOrResponse(userId, workspaceId);
    if (resolved instanceof Response) return resolved;
    if (resolved.backend === "remote") {
      try {
        const statusResponse = await requestRemoteOmoDaemon({
          workspace: resolved,
          userId,
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
  return proxyOmoRequest({ request, userId, workspaceId, pathSegments });
}

async function proxyToOpenCodeServer(
  input: EngineProxyRequest,
): Promise<Response> {
  const { request, userId, workspaceId, pathSegments } = input;
  const opencodePath = "/" + pathSegments.join("/");
  const requestedSessionId = pathSegments[1];
  if (pathSegments[0] === "session" && requestedSessionId?.startsWith("omo_")) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  let serverUrl: string;
  let directory: string | undefined;
  let workspace: Workspace | null = null;
  try {
    const target = await resolveOpenCodeTarget(userId, workspaceId);
    serverUrl = target.serverUrl;
    directory = target.directory;
    workspace = target.workspace;
    if (
      pathSegments[0] === "session" &&
      requestedSessionId?.startsWith("ses_")
    ) {
      await authorizeOpenCodeSession(target, requestedSessionId);
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

  const url = new URL(request.url);
  const targetUrl = new URL(opencodePath, serverUrl);

  // Forward the query except dev-hub's own params, and inject directory
  url.searchParams.forEach((value, key) => {
    if (!DEV_HUB_QUERY_PARAMS.has(key)) {
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
    if (workspace?.backend === "remote" && !isSSE && request.method !== "GET") {
      const retryResponse = await retryAutoSuspendRequest({
        workspace,
        userId,
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

function proxyToEngine(
  engine: ChatEngine,
  input: EngineProxyRequest,
): Promise<Response> {
  return engine === "omo" ? proxyToOmo(input) : proxyToOpenCodeServer(input);
}

function settleWithin<T>(
  promise: Promise<T>,
  budgetMs: number,
): Promise<T | undefined> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(undefined), budgetMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(undefined);
      },
    );
  });
}

async function readOkJson(
  response: Response | undefined,
): Promise<unknown | undefined> {
  if (response === undefined || !response.ok) return undefined;
  return response.json().catch(() => undefined);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mergeEngineBodies(
  shape: "list" | "record",
  primary: unknown,
  secondary: unknown,
): unknown {
  if (shape === "list" && Array.isArray(primary) && Array.isArray(secondary)) {
    return [...primary, ...secondary];
  }
  if (
    shape === "record" &&
    isPlainRecord(primary) &&
    isPlainRecord(secondary)
  ) {
    return { ...secondary, ...primary };
  }
  return primary;
}

// The workspace's default engine stays authoritative: its failure is the
// answer, so the client keeps its cache exactly as before. The other engine
// only adds to a successful answer and is skipped when it fails or is slow.
async function mergeEngineReads(
  input: EngineProxyRequest,
  primaryEngine: ChatEngine,
  shape: "list" | "record",
): Promise<Response> {
  const secondaryEngine: ChatEngine =
    primaryEngine === "omo" ? "opencode" : "omo";
  let canReachSecondary = false;
  try {
    const workspace = await resolveOmoWorkspace(
      input.userId,
      input.workspaceId,
    );
    canReachSecondary = canWorkspaceRunEngine(workspace, secondaryEngine);
  } catch (error) {
    if (!(error instanceof OpenCodeTargetError)) throw error;
  }
  const [primaryResponse, secondaryResponse] = await Promise.all([
    proxyToEngine(primaryEngine, input),
    canReachSecondary
      ? settleWithin(
          proxyToEngine(secondaryEngine, input),
          SECONDARY_ENGINE_READ_BUDGET_MS,
        )
      : Promise.resolve(undefined),
  ]);
  if (!primaryResponse.ok) return primaryResponse;
  const primaryBody: unknown = await primaryResponse.json();
  const secondaryBody = await readOkJson(secondaryResponse);
  return NextResponse.json(
    secondaryBody === undefined
      ? primaryBody
      : mergeEngineBodies(shape, primaryBody, secondaryBody),
  );
}

async function proxyRequest(
  request: NextRequest,
  { params }: RouteParams,
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { path } = await params;
  const url = new URL(request.url);
  const workspaceId = url.searchParams.get("workspaceId");
  if (!workspaceId) {
    return NextResponse.json(
      { error: "workspaceId is required" },
      { status: 400 },
    );
  }

  const input: EngineProxyRequest = {
    request,
    userId: session.user.id,
    workspaceId,
    pathSegments: path,
  };
  const choice = chooseRequestEngine({
    method: request.method,
    pathSegments: path,
    engineParam: url.searchParams.get("engine"),
  });
  if (choice.kind === "engine") return proxyToEngine(choice.engine, input);
  const workspaceEngine = await resolveWorkspaceEngine(
    session.user.id,
    workspaceId,
  );
  if (choice.kind === "workspace-default") {
    return proxyToEngine(workspaceEngine, input);
  }
  return mergeEngineReads(input, workspaceEngine, choice.shape);
}

export const GET = proxyRequest;
export const POST = proxyRequest;
export const PUT = proxyRequest;
export const DELETE = proxyRequest;
export const PATCH = proxyRequest;

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

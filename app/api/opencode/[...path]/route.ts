import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db";
import { settings, workspaces } from "@/drizzle/schema";
import { eq, and } from "drizzle-orm";
import { getBackend, toWorkspace } from "@/lib/workspaces/backend";
import type { Workspace, WorkspaceProvider } from "@/types";

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

  let serverUrl: string;
  let directory: string | undefined;
  let workspace: Workspace | null = null;

  if (workspaceId) {
    const [row] = await db
      .select()
      .from(workspaces)
      .where(
        and(
          eq(workspaces.id, workspaceId),
          eq(workspaces.userId, session.user.id),
        ),
      );
    if (!row) {
      return NextResponse.json(
        { error: "Workspace not found" },
        { status: 404 },
      );
    }

    workspace = toWorkspace(row);
    const backend = getBackend(workspace);

    try {
      serverUrl = await backend.getOpenCodeUrl();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to start OpenCode server";
      return NextResponse.json(
        { error: "OpenCode server unavailable", detail: message },
        { status: 503 },
      );
    }

    // Local workspaces need directory param; remote containers are pre-scoped
    if (workspace.backend !== "remote") {
      directory = workspace.path;
    }
  } else {
    // No workspace specified — fall back to local OpenCode server
    try {
      const { getOrStartServer } = await import("@/lib/opencode/server-pool");
      const { url: localUrl } = await getOrStartServer();
      serverUrl = localUrl;
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to start OpenCode server";
      return NextResponse.json(
        { error: "OpenCode server unavailable", detail: message },
        { status: 503 },
      );
    }
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

  if (!isSSE) {
    fetchOptions.signal = AbortSignal.timeout(15_000);
  }

  try {
    const upstream = await fetch(targetUrl.toString(), fetchOptions);
    return proxyResponse(upstream, isSSE);
  } catch (error) {
    if (workspaceId && workspace?.backend === "remote" && !isSSE) {
      const supportsAutoSuspend = await workspaceSupportsAutoSuspend(
        workspace,
        session.user.id,
      );

      if (supportsAutoSuspend) {
        const delays = [2000, 4000, 8000, 8000, 8000];
        for (const delayMs of delays) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          try {
            const retryResponse = await fetch(targetUrl.toString(), {
              ...fetchOptions,
              signal: AbortSignal.timeout(10_000),
            });
            return proxyResponse(retryResponse, false);
          } catch {
            continue;
          }
        }
      }
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

async function workspaceSupportsAutoSuspend(
  workspace: Workspace,
  userId: string,
): Promise<boolean> {
  const providerMeta = workspace.providerMeta as Record<string, unknown> | null;
  const providerId =
    providerMeta && typeof providerMeta.providerId === "string"
      ? providerMeta.providerId
      : null;
  if (!providerId) return false;

  const [settingRow] = await db
    .select()
    .from(settings)
    .where(
      and(eq(settings.userId, userId), eq(settings.key, "workspace-providers")),
    );
  if (!settingRow) return false;

  const providers = Array.isArray(settingRow.value)
    ? (settingRow.value as unknown[])
    : [];

  const provider = providers.find(
    (candidate) =>
      candidate &&
      typeof candidate === "object" &&
      (candidate as Record<string, unknown>).id === providerId,
  ) as WorkspaceProvider | undefined;

  return provider?.behaviour?.supportsAutoSuspend === true;
}

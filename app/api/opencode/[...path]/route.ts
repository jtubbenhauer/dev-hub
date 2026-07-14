import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db";
import { settings } from "@/drizzle/schema";
import { eq, and } from "drizzle-orm";
import {
  resolveOpenCodeTarget,
  OpenCodeTargetError,
} from "@/lib/opencode/proxy-target";
import { fetchWithHeaderTimeout } from "@/lib/opencode/fetch-timeout";
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
  try {
    const target = await resolveOpenCodeTarget(session.user.id, workspaceId);
    serverUrl = target.serverUrl;
    directory = target.directory;
    workspace = target.workspace;
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
      const supportsAutoSuspend = await workspaceSupportsAutoSuspend(
        workspace,
        session.user.id,
      );

      if (supportsAutoSuspend) {
        const delays = [2000, 4000, 8000, 8000, 8000];
        for (const delayMs of delays) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          try {
            const retryResponse = await fetchWithHeaderTimeout(
              targetUrl.toString(),
              fetchOptions,
              10_000,
            );
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

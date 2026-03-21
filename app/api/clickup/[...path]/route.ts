import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db";
import { settings } from "@/drizzle/schema";
import { eq, and } from "drizzle-orm";

const CLICKUP_API_BASE = "https://api.clickup.com/api/v2";

interface RouteParams {
  params: Promise<{ path: string[] }>;
}

async function getClickUpToken(userId: string): Promise<string | null> {
  const [row] = await db
    .select()
    .from(settings)
    .where(
      and(eq(settings.userId, userId), eq(settings.key, "clickup-api-token")),
    );
  const value = row?.value;
  return typeof value === "string" && value.length > 0 ? value : null;
}

async function proxyToClickUp(
  request: NextRequest,
  { params }: RouteParams,
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const token = await getClickUpToken(session.user.id);
  if (!token) {
    return NextResponse.json(
      { error: "ClickUp API token not configured" },
      { status: 422 },
    );
  }

  const { path } = await params;
  const clickUpPath = path.join("/");

  const incomingUrl = new URL(request.url);
  const targetUrl = new URL(`${CLICKUP_API_BASE}/${clickUpPath}`);
  incomingUrl.searchParams.forEach((value, key) => {
    targetUrl.searchParams.set(key, value);
  });

  const headers = new Headers({ Authorization: token });
  const contentType = request.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);

  const fetchOptions: RequestInit = { method: request.method, headers };
  if (request.method !== "GET" && request.method !== "HEAD" && contentType) {
    fetchOptions.body = await request.text();
  }

  try {
    const upstream = await fetch(targetUrl.toString(), fetchOptions);

    if (upstream.status === 204 || upstream.status === 304) {
      return new Response(null, { status: upstream.status });
    }

    const responseHeaders = new Headers();
    const upstreamContentType = upstream.headers.get("content-type");
    if (upstreamContentType)
      responseHeaders.set("content-type", upstreamContentType);

    const body = await upstream.arrayBuffer();
    return new Response(body, {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Proxy request failed";
    console.error(
      `[clickup-proxy] ${request.method} /${clickUpPath} failed: ${message}`,
    );
    return NextResponse.json(
      { error: "ClickUp proxy error", detail: message },
      { status: 502 },
    );
  }
}

export const GET = proxyToClickUp;
export const POST = proxyToClickUp;
export const PUT = proxyToClickUp;
export const DELETE = proxyToClickUp;
export const PATCH = proxyToClickUp;

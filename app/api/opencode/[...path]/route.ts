import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth/config"
import { db } from "@/lib/db"
import { workspaces } from "@/drizzle/schema"
import { eq, and } from "drizzle-orm"
import { getServerUrl } from "@/lib/opencode/client"

interface RouteParams {
  params: Promise<{ path: string[] }>
}

async function resolveWorkspaceDirectory(
  workspaceId: string,
  userId: string
): Promise<string | null> {
  const [workspace] = await db
    .select()
    .from(workspaces)
    .where(
      and(eq(workspaces.id, workspaceId), eq(workspaces.userId, userId))
    )
  return workspace?.path ?? null
}

async function proxyToOpenCode(
  request: NextRequest,
  { params }: RouteParams
): Promise<Response> {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const pathSegments = await params
  const opencodePath = "/" + pathSegments.path.join("/")

  const url = new URL(request.url)
  const workspaceId = url.searchParams.get("workspaceId")

  let directory: string | undefined
  if (workspaceId) {
    const resolved = await resolveWorkspaceDirectory(
      workspaceId,
      session.user.id
    )
    if (!resolved) {
      return NextResponse.json(
        { error: "Workspace not found" },
        { status: 404 }
      )
    }
    directory = resolved
  }

  let serverUrl: string
  try {
    serverUrl = await getServerUrl()
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to start OpenCode server"
    return NextResponse.json(
      { error: "OpenCode server unavailable", detail: message },
      { status: 503 }
    )
  }

  const targetUrl = new URL(opencodePath, serverUrl)

  // Forward all query params except workspaceId, and inject directory
  url.searchParams.forEach((value, key) => {
    if (key !== "workspaceId") {
      targetUrl.searchParams.set(key, value)
    }
  })
  if (directory) {
    targetUrl.searchParams.set("directory", directory)
  }

  const headers = new Headers()
  const contentType = request.headers.get("content-type")
  if (contentType) {
    headers.set("content-type", contentType)
  }
  const accept = request.headers.get("accept")
  if (accept) {
    headers.set("accept", accept)
  }

  const isSSE =
    accept?.includes("text/event-stream") ||
    opencodePath === "/event" ||
    opencodePath === "/global/event"

  const fetchOptions: RequestInit = {
    method: request.method,
    headers,
  }

  if (
    request.method !== "GET" &&
    request.method !== "HEAD" &&
    contentType
  ) {
    fetchOptions.body = await request.text()
  }

  try {
    const upstream = await fetch(targetUrl.toString(), fetchOptions)

    if (isSSE && upstream.body) {
      return new Response(upstream.body, {
        status: upstream.status,
        headers: {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        },
      })
    }

    const responseHeaders = new Headers()
    const upstreamContentType = upstream.headers.get("content-type")
    if (upstreamContentType) {
      responseHeaders.set("content-type", upstreamContentType)
    }

    const body = await upstream.arrayBuffer()
    return new Response(body, {
      status: upstream.status,
      headers: responseHeaders,
    })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Proxy request failed"
    console.error(`[opencode-proxy] ${request.method} ${opencodePath} failed: ${message}`)
    return NextResponse.json(
      { error: "OpenCode proxy error", detail: message },
      { status: 502 }
    )
  }
}

export const GET = proxyToOpenCode
export const POST = proxyToOpenCode
export const PUT = proxyToOpenCode
export const DELETE = proxyToOpenCode
export const PATCH = proxyToOpenCode

// SSE connections can be long-lived
export const maxDuration = 300

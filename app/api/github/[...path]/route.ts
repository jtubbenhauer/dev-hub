import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth/config"
import { db } from "@/lib/db"
import { settings } from "@/drizzle/schema"
import { eq, and } from "drizzle-orm"

const GITHUB_API_BASE = "https://api.github.com"

interface RouteParams {
  params: Promise<{ path: string[] }>
}

async function getGitHubToken(userId: string): Promise<string | null> {
  const [row] = await db
    .select()
    .from(settings)
    .where(and(eq(settings.userId, userId), eq(settings.key, "github-api-token")))
  const value = row?.value
  return typeof value === "string" && value.length > 0 ? value : null
}

async function proxyToGitHub(request: NextRequest, { params }: RouteParams): Promise<Response> {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const token = await getGitHubToken(session.user.id)
  if (!token) {
    return NextResponse.json({ error: "GitHub API token not configured" }, { status: 422 })
  }

  const { path } = await params
  const githubPath = path.join("/")

  const incomingUrl = new URL(request.url)
  const targetUrl = new URL(`${GITHUB_API_BASE}/${githubPath}`)
  incomingUrl.searchParams.forEach((value, key) => {
    targetUrl.searchParams.set(key, value)
  })

  const headers = new Headers({
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  })
  const contentType = request.headers.get("content-type")
  if (contentType) headers.set("content-type", contentType)

  const fetchOptions: RequestInit = { method: request.method, headers }
  if (request.method !== "GET" && request.method !== "HEAD" && contentType) {
    fetchOptions.body = await request.text()
  }

  try {
    const upstream = await fetch(targetUrl.toString(), fetchOptions)

    if (upstream.status === 204 || upstream.status === 304) {
      return new Response(null, { status: upstream.status })
    }

    const responseHeaders = new Headers()
    const upstreamContentType = upstream.headers.get("content-type")
    if (upstreamContentType) responseHeaders.set("content-type", upstreamContentType)

    const body = await upstream.arrayBuffer()
    return new Response(body, { status: upstream.status, headers: responseHeaders })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Proxy request failed"
    console.error(`[github-proxy] ${request.method} /${githubPath} failed: ${message}`)
    return NextResponse.json({ error: "GitHub proxy error", detail: message }, { status: 502 })
  }
}

export const GET = proxyToGitHub
export const POST = proxyToGitHub
export const PUT = proxyToGitHub
export const DELETE = proxyToGitHub
export const PATCH = proxyToGitHub

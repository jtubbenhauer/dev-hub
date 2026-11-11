import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { GITHUB_NOT_CONNECTED_MESSAGE } from "@/lib/github/github-auth-status";
import { isAllowedGitHubRequest } from "@/lib/github/github-proxy-allowlist";
import { forgetGhToken, resolveGitHubToken } from "@/lib/github/github-token";

const GITHUB_API_BASE = "https://api.github.com";

interface RouteParams {
  params: Promise<{ path: string[] }>;
}

async function proxyToGitHub(
  request: NextRequest,
  { params }: RouteParams,
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  const { path } = await params;
  const githubPath = path.join("/");

  const incomingUrl = new URL(request.url);
  const targetUrl = new URL(`${GITHUB_API_BASE}/${githubPath}`);
  // Checked after URL parsing has resolved any ".." segments.
  const isAllowed =
    targetUrl.origin === GITHUB_API_BASE &&
    isAllowedGitHubRequest(request.method, targetUrl.pathname.slice(1));
  if (!isAllowed) {
    return NextResponse.json(
      { error: `dev-hub does not proxy ${request.method} /${githubPath}` },
      { status: 403 },
    );
  }

  const token = await resolveGitHubToken(userId);
  if (!token) {
    return NextResponse.json(
      { error: GITHUB_NOT_CONNECTED_MESSAGE },
      { status: 422 },
    );
  }

  incomingUrl.searchParams.forEach((value, key) => {
    targetUrl.searchParams.set(key, value);
  });

  const contentType = request.headers.get("content-type");
  const body =
    request.method !== "GET" && request.method !== "HEAD" && contentType
      ? await request.text()
      : undefined;
  const requestGitHub = (tokenValue: string) => {
    const headers = new Headers({
      Authorization: `Bearer ${tokenValue}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    });
    if (contentType) headers.set("content-type", contentType);
    return fetch(targetUrl.toString(), {
      method: request.method,
      headers,
      body,
    });
  };

  try {
    let upstream = await requestGitHub(token.value);
    // gh hands out a new token after `gh auth login` or `gh auth refresh`;
    // read it again once when GitHub rejects the cached one.
    if (upstream.status === 401 && token.source === "gh") {
      forgetGhToken();
      const refreshedToken = await resolveGitHubToken(userId);
      if (refreshedToken && refreshedToken.value !== token.value) {
        upstream = await requestGitHub(refreshedToken.value);
      }
    }

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
      `[github-proxy] ${request.method} /${githubPath} failed: ${message}`,
    );
    return NextResponse.json(
      { error: "GitHub proxy error", detail: message },
      { status: 502 },
    );
  }
}

export const GET = proxyToGitHub;
export const POST = proxyToGitHub;
export const PUT = proxyToGitHub;
export const DELETE = proxyToGitHub;
export const PATCH = proxyToGitHub;

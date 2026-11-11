// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GitHubToken } from "@/lib/github/github-token";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  resolveGitHubToken: vi.fn<(userId: string) => Promise<GitHubToken | null>>(),
  forgetGhToken: vi.fn(),
}));

vi.mock("@/lib/auth/config", () => ({ auth: mocks.auth }));
vi.mock("@/lib/github/github-token", () => ({
  resolveGitHubToken: mocks.resolveGitHubToken,
  forgetGhToken: mocks.forgetGhToken,
}));

import { GET, POST } from "@/app/api/github/[...path]/route";

const fetchMock =
  vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();

function routeContext(path: string[]) {
  return { params: Promise.resolve({ path }) };
}

function authorizationOf(call: number): string | null {
  return new Headers(fetchMock.mock.calls[call]?.[1]?.headers).get(
    "Authorization",
  );
}

beforeEach(() => {
  mocks.auth.mockReset();
  mocks.auth.mockResolvedValue({ user: { id: "user-1" } });
  mocks.resolveGitHubToken.mockReset();
  mocks.resolveGitHubToken.mockResolvedValue({
    value: "gho_cli",
    source: "gh",
  });
  mocks.forgetGhToken.mockReset();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(Response.json([{ number: 7 }]));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GitHub proxy", () => {
  it("forwards an allowed request with the resolved token and its query string", async () => {
    const response = await GET(
      new NextRequest(
        "http://localhost:3000/api/github/repos/acme/web/pulls?state=open",
      ),
      routeContext(["repos", "acme", "web", "pulls"]),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([{ number: 7 }]);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.github.com/repos/acme/web/pulls?state=open",
    );
    expect(authorizationOf(0)).toBe("Bearer gho_cli");
    expect(mocks.resolveGitHubToken).toHaveBeenCalledWith("user-1");
  });

  it("forwards a GraphQL query body", async () => {
    const body = JSON.stringify({ query: "{ viewer { login } }" });

    await POST(
      new NextRequest("http://localhost:3000/api/github/graphql", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      }),
      routeContext(["graphql"]),
    );

    expect(fetchMock.mock.calls[0][0]).toBe("https://api.github.com/graphql");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "POST", body });
  });

  it("explains how to connect when there is no GitHub login", async () => {
    mocks.resolveGitHubToken.mockResolvedValue(null);

    const response = await GET(
      new NextRequest("http://localhost:3000/api/github/user"),
      routeContext(["user"]),
    );

    expect(response.status).toBe(422);
    expect((await response.json()).error).toMatch(/gh auth login/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reads the gh token again once when GitHub rejects the cached one", async () => {
    mocks.resolveGitHubToken
      .mockResolvedValueOnce({ value: "gho_old", source: "gh" })
      .mockResolvedValueOnce({ value: "gho_new", source: "gh" });
    fetchMock
      .mockResolvedValueOnce(
        Response.json({ message: "Bad credentials" }, { status: 401 }),
      )
      .mockResolvedValueOnce(Response.json({ login: "miguelvaladez" }));

    const response = await GET(
      new NextRequest("http://localhost:3000/api/github/user"),
      routeContext(["user"]),
    );

    expect(response.status).toBe(200);
    expect(mocks.forgetGhToken).toHaveBeenCalledOnce();
    expect(authorizationOf(0)).toBe("Bearer gho_old");
    expect(authorizationOf(1)).toBe("Bearer gho_new");
  });

  it("passes on a rejection of the saved token without retrying", async () => {
    mocks.resolveGitHubToken.mockResolvedValue({
      value: "github_pat_saved",
      source: "settings",
    });
    fetchMock.mockResolvedValue(
      Response.json({ message: "Bad credentials" }, { status: 401 }),
    );

    const response = await GET(
      new NextRequest("http://localhost:3000/api/github/user"),
      routeContext(["user"]),
    );

    expect(response.status).toBe(401);
    expect(mocks.forgetGhToken).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("refuses requests from outside a dev-hub session", async () => {
    mocks.auth.mockResolvedValue(null);

    const response = await GET(
      new NextRequest("http://localhost:3000/api/github/user"),
      routeContext(["user"]),
    );

    expect(response.status).toBe(401);
    expect(mocks.resolveGitHubToken).not.toHaveBeenCalled();
  });
});

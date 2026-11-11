// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  getGhToken: vi.fn<() => Promise<string | null>>(),
  forgetGhToken: vi.fn(),
  readSettingsToken: vi.fn<(userId: string) => Promise<string | null>>(),
  fetchGitHubLogin: vi.fn<(token: string) => Promise<string | null>>(),
}));

vi.mock("@/lib/auth/config", () => ({ auth: mocks.auth }));
vi.mock("@/lib/github/github-token", () => ({
  getGhToken: mocks.getGhToken,
  forgetGhToken: mocks.forgetGhToken,
  readSettingsToken: mocks.readSettingsToken,
  fetchGitHubLogin: mocks.fetchGitHubLogin,
}));

import { GET } from "@/app/api/github-auth/route";

const LOGINS: Record<string, string> = {
  gho_cli: "miguelvaladez",
  github_pat_saved: "miguelvaladez",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: "user-1" } });
  mocks.fetchGitHubLogin.mockImplementation(
    async (token) => LOGINS[token] ?? null,
  );
});

describe("GET /api/github-auth", () => {
  it("reports the gh login as active and the saved token as a fallback", async () => {
    mocks.getGhToken.mockResolvedValue("gho_cli");
    mocks.readSettingsToken.mockResolvedValue("github_pat_saved");

    const response = await GET();

    expect(await response.json()).toEqual({
      activeSource: "gh",
      ghLogin: "miguelvaladez",
      hasSavedToken: true,
      savedTokenLogin: "miguelvaladez",
    });
    expect(mocks.readSettingsToken).toHaveBeenCalledWith("user-1");
  });

  it("reads gh afresh so a new gh login shows up right away", async () => {
    mocks.getGhToken.mockResolvedValue(null);
    mocks.readSettingsToken.mockResolvedValue(null);

    await GET();

    expect(mocks.forgetGhToken).toHaveBeenCalledOnce();
    expect(mocks.forgetGhToken.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.getGhToken.mock.invocationCallOrder[0],
    );
  });

  it("uses the saved token when gh has no login, and flags one GitHub rejects", async () => {
    mocks.getGhToken.mockResolvedValue(null);
    mocks.readSettingsToken.mockResolvedValue("github_pat_revoked");

    const response = await GET();

    expect(await response.json()).toEqual({
      activeSource: "settings",
      ghLogin: null,
      hasSavedToken: true,
      savedTokenLogin: null,
    });
  });

  it("reports no login when neither is available", async () => {
    mocks.getGhToken.mockResolvedValue(null);
    mocks.readSettingsToken.mockResolvedValue(null);

    const response = await GET();

    expect(await response.json()).toMatchObject({
      activeSource: null,
      hasSavedToken: false,
    });
    expect(mocks.fetchGitHubLogin).not.toHaveBeenCalled();
  });

  it("refuses requests from outside a dev-hub session", async () => {
    mocks.auth.mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(401);
    expect(mocks.getGhToken).not.toHaveBeenCalled();
  });
});

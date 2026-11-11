import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import { GitHubSettingsCard } from "@/components/settings/github-settings-card";
import type { GitHubAuthStatus } from "@/lib/github/github-auth-status";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const GH_ACTIVE: GitHubAuthStatus = {
  activeSource: "gh",
  ghLogin: "miguelvaladez",
  hasSavedToken: false,
  savedTokenLogin: null,
};

// A fake dev-hub server: saving a token changes what /api/github-auth says.
let savedSettings: Record<string, unknown>;
let authStatus: GitHubAuthStatus;
let statusAfterSave: GitHubAuthStatus;
let fetchMock: ReturnType<typeof vi.fn>;

function stubServer() {
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/settings" && init?.method === "PUT") {
      const { key, value } = JSON.parse(String(init.body)) as {
        key: string;
        value: unknown;
      };
      savedSettings = { ...savedSettings, [key]: value };
      authStatus = statusAfterSave;
      return Response.json({ key, value });
    }
    if (url === "/api/settings") return Response.json(savedSettings);
    if (url === "/api/github-auth") return Response.json(authStatus);
    throw new Error(`Unexpected request: ${init?.method ?? "GET"} ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
}

function renderCard() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <GitHubSettingsCard />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  savedSettings = {};
  authStatus = GH_ACTIVE;
  statusAfterSave = GH_ACTIVE;
  vi.mocked(toast.success).mockClear();
  stubServer();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GitHubSettingsCard", () => {
  it("says dev-hub is signed in with the GitHub CLI", async () => {
    renderCard();

    expect(
      await screen.findByText("Signed in with the GitHub CLI as miguelvaladez"),
    ).toBeInTheDocument();
  });

  it("explains how to connect when there is no GitHub login", async () => {
    authStatus = {
      activeSource: null,
      ghLogin: null,
      hasSavedToken: false,
      savedTokenLogin: null,
    };

    renderCard();

    const status = await screen.findByText(/Not connected/);
    expect(status).toHaveTextContent("gh auth login");
  });

  it("flags a GitHub CLI login that GitHub rejects", async () => {
    authStatus = { ...GH_ACTIVE, ghLogin: null };

    renderCard();

    expect(
      await screen.findByText(/GitHub rejected the GitHub CLI login/),
    ).toBeInTheDocument();
  });

  it("checks a newly saved token itself, not the GitHub CLI login", async () => {
    statusAfterSave = {
      ...GH_ACTIVE,
      hasSavedToken: true,
      savedTokenLogin: "miguel-bot",
    };
    renderCard();

    await userEvent.type(
      await screen.findByLabelText("Fallback personal access token"),
      "ghp_new",
    );
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("Token saved for miguel-bot"),
    );
    expect(savedSettings["github-api-token"]).toBe("ghp_new");
    expect(
      await screen.findByText("The saved token (miguel-bot) is the fallback."),
    ).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(([input]) =>
        String(input).includes("/api/github/"),
      ),
    ).toBe(false);
  });

  it("reports a saved token that GitHub rejects", async () => {
    statusAfterSave = { ...GH_ACTIVE, hasSavedToken: true };
    renderCard();

    await userEvent.type(
      await screen.findByLabelText("Fallback personal access token"),
      "github_pat_fine_grained",
    );
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(
      await screen.findByText("GitHub rejected this token"),
    ).toBeInTheDocument();
    expect(toast.success).not.toHaveBeenCalled();
    // One rejection message, not a second fallback-token warning beside it.
    expect(
      screen.queryByText("GitHub rejects the saved fallback token."),
    ).toBeNull();
  });

  it("removes the saved token", async () => {
    savedSettings = { "github-api-token": "ghp_saved" };
    authStatus = {
      ...GH_ACTIVE,
      hasSavedToken: true,
      savedTokenLogin: "miguelvaladez",
    };
    renderCard();

    await userEvent.click(
      await screen.findByRole("button", { name: "Remove" }),
    );

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("Saved token removed"),
    );
    expect(savedSettings["github-api-token"]).toBe("");
  });

  it("links to a classic token with the repo scope", async () => {
    renderCard();

    const link = await screen.findByRole("link", {
      name: /Create a classic token/,
    });
    expect(link).toHaveAttribute(
      "href",
      expect.stringContaining("scopes=repo"),
    );
  });
});

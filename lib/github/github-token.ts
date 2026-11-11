import { execFile } from "node:child_process";
import { and, eq } from "drizzle-orm";
import { settings } from "@/drizzle/schema";
import { db } from "@/lib/db";
import type { GitHubAuthSource } from "@/lib/github/github-auth-status";

// Server only. dev-hub signs GitHub requests with the GitHub CLI login on the
// machine running it (`gh auth login`), and falls back to the token saved in
// Settings when gh is missing or signed out.

export interface GitHubToken {
  value: string;
  source: GitHubAuthSource;
}

const GITHUB_HOSTNAME = "github.com";
const GITHUB_TOKEN_SETTING_KEY = "github-api-token";
const GH_TOKEN_TTL_MS = 5 * 60_000;
const GH_UNAVAILABLE_TTL_MS = 30_000;
const GH_TIMEOUT_MS = 5_000;
// Where Homebrew and distro packages install gh, for servers whose PATH
// lacks it.
const GH_FALLBACK_BINARIES = [
  "/opt/homebrew/bin/gh",
  "/usr/local/bin/gh",
  "/usr/bin/gh",
];

type GhTokenRead =
  | { kind: "token"; token: string }
  | { kind: "signed-out" }
  | { kind: "missing-binary" };

interface CachedGhToken {
  promise: Promise<string | null>;
  expiresAt: number;
}

let cachedGhToken: CachedGhToken | null = null;

function ghBinaryCandidates(): string[] {
  const configuredBinary = process.env.GH_BIN?.trim();
  if (configuredBinary) return [configuredBinary];
  return ["gh", ...GH_FALLBACK_BINARIES];
}

function runGhAuthToken(binary: string): Promise<GhTokenRead> {
  return new Promise((resolve) => {
    execFile(
      binary,
      ["auth", "token", "--hostname", GITHUB_HOSTNAME],
      {
        timeout: GH_TIMEOUT_MS,
        env: { ...process.env, GH_PROMPT_DISABLED: "1" },
      },
      (error, stdout) => {
        if (error) {
          const code = (error as NodeJS.ErrnoException).code;
          resolve(
            code === "ENOENT"
              ? { kind: "missing-binary" }
              : { kind: "signed-out" },
          );
          return;
        }
        const token = stdout.trim();
        resolve(token ? { kind: "token", token } : { kind: "signed-out" });
      },
    );
  });
}

async function readGhToken(): Promise<string | null> {
  for (const binary of ghBinaryCandidates()) {
    const result = await runGhAuthToken(binary);
    if (result.kind === "missing-binary") continue;
    return result.kind === "token" ? result.token : null;
  }
  return null;
}

// The token gh prints for github.com, or null when gh is missing or signed
// out. Concurrent callers share one `gh auth token` run.
export function getGhToken(): Promise<string | null> {
  if (cachedGhToken && cachedGhToken.expiresAt > Date.now()) {
    return cachedGhToken.promise;
  }
  const entry: CachedGhToken = {
    promise: readGhToken(),
    expiresAt: Number.POSITIVE_INFINITY,
  };
  cachedGhToken = entry;
  void entry.promise.then((token) => {
    entry.expiresAt =
      Date.now() + (token ? GH_TOKEN_TTL_MS : GH_UNAVAILABLE_TTL_MS);
  });
  return entry.promise;
}

// Call when GitHub rejects the cached token, or to pick up a fresh
// `gh auth login`.
export function forgetGhToken(): void {
  cachedGhToken = null;
}

export async function readSettingsToken(
  userId: string,
): Promise<string | null> {
  const [row] = await db
    .select()
    .from(settings)
    .where(
      and(
        eq(settings.userId, userId),
        eq(settings.key, GITHUB_TOKEN_SETTING_KEY),
      ),
    );
  const value = row?.value;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function resolveGitHubToken(
  userId: string,
): Promise<GitHubToken | null> {
  const ghToken = await getGhToken();
  if (ghToken) return { value: ghToken, source: "gh" };
  const savedToken = await readSettingsToken(userId);
  return savedToken ? { value: savedToken, source: "settings" } : null;
}

// The GitHub user a token belongs to, or null when GitHub rejects it.
export async function fetchGitHubLogin(token: string): Promise<string | null> {
  try {
    const response = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (!response.ok) return null;
    const user = (await response.json()) as { login?: unknown };
    return typeof user.login === "string" ? user.login : null;
  } catch (error) {
    console.error("[github-auth] could not reach GitHub:", error);
    return null;
  }
}

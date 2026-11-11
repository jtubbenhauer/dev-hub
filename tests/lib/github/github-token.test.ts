// @vitest-environment node
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/drizzle/schema";

const state = vi.hoisted(() => ({ db: undefined as unknown }));
const childProcess = vi.hoisted(() => ({ execFile: vi.fn() }));

vi.mock("@/lib/db", () => ({
  get db() {
    return state.db;
  },
}));
vi.mock("node:child_process", () => ({ execFile: childProcess.execFile }));

import {
  fetchGitHubLogin,
  forgetGhToken,
  resolveGitHubToken,
} from "@/lib/github/github-token";

const USER = "user-1";

type GhOutcome =
  | { kind: "token"; stdout: string }
  | { kind: "signed-out" }
  | { kind: "missing" };

// What each gh binary path does when asked for a token.
let ghByBinary: Record<string, GhOutcome>;
let sqlite: Database.Database;

function saveSettingsToken(value: string) {
  sqlite
    .prepare("INSERT INTO settings (user_id, key, value) VALUES (?, ?, ?)")
    .run(USER, "github-api-token", JSON.stringify(value));
}

function ghBinariesRun(): string[] {
  return childProcess.execFile.mock.calls.map((call) => call[0] as string);
}

beforeEach(() => {
  forgetGhToken();
  delete process.env.GH_BIN;
  ghByBinary = {};
  childProcess.execFile.mockReset();
  childProcess.execFile.mockImplementation(
    (
      binary: string,
      _args: string[],
      _options: unknown,
      callback: (error: Error | null, stdout: string) => void,
    ) => {
      const outcome = ghByBinary[binary] ?? { kind: "missing" };
      if (outcome.kind === "token") {
        callback(null, outcome.stdout);
      } else if (outcome.kind === "signed-out") {
        callback(Object.assign(new Error("no oauth token"), { code: 1 }), "");
      } else {
        callback(
          Object.assign(new Error("spawn gh ENOENT"), { code: "ENOENT" }),
          "",
        );
      }
    },
  );
  sqlite = new Database(":memory:");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: "drizzle/migrations" });
  state.db = db;
  sqlite
    .prepare(
      "INSERT INTO users (id, username, password_hash) VALUES (?, ?, 'hash')",
    )
    .run(USER, "user");
});

afterEach(() => {
  sqlite.close();
  delete process.env.GH_BIN;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("resolveGitHubToken", () => {
  it("signs with the GitHub CLI login for github.com, ahead of a saved token", async () => {
    ghByBinary.gh = { kind: "token", stdout: "gho_cli\n" };
    saveSettingsToken("github_pat_saved");

    await expect(resolveGitHubToken(USER)).resolves.toEqual({
      value: "gho_cli",
      source: "gh",
    });
    expect(childProcess.execFile).toHaveBeenCalledWith(
      "gh",
      ["auth", "token", "--hostname", "github.com"],
      expect.objectContaining({
        timeout: 5_000,
        env: expect.objectContaining({ GH_PROMPT_DISABLED: "1" }),
      }),
      expect.any(Function),
    );
  });

  it("falls back to the saved token when gh is signed out", async () => {
    ghByBinary.gh = { kind: "signed-out" };
    saveSettingsToken("  github_pat_saved  ");

    await expect(resolveGitHubToken(USER)).resolves.toEqual({
      value: "github_pat_saved",
      source: "settings",
    });
    expect(ghBinariesRun()).toEqual(["gh"]);
  });

  it("finds gh in Homebrew's folder when it is not on the server's PATH", async () => {
    ghByBinary["/opt/homebrew/bin/gh"] = { kind: "token", stdout: "gho_brew" };

    await expect(resolveGitHubToken(USER)).resolves.toEqual({
      value: "gho_brew",
      source: "gh",
    });
    expect(ghBinariesRun()).toEqual(["gh", "/opt/homebrew/bin/gh"]);
  });

  it("runs only the binary GH_BIN names", async () => {
    process.env.GH_BIN = "/custom/bin/gh";
    ghByBinary.gh = { kind: "token", stdout: "gho_ignored" };

    await expect(resolveGitHubToken(USER)).resolves.toBeNull();
    expect(ghBinariesRun()).toEqual(["/custom/bin/gh"]);
  });

  it("is not connected without a gh login or a saved token", async () => {
    saveSettingsToken("");

    await expect(resolveGitHubToken(USER)).resolves.toBeNull();
    expect(ghBinariesRun()).toEqual([
      "gh",
      "/opt/homebrew/bin/gh",
      "/usr/local/bin/gh",
      "/usr/bin/gh",
    ]);
  });

  it("reuses the gh token for five minutes and re-reads it after forgetGhToken", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    ghByBinary.gh = { kind: "token", stdout: "gho_first" };

    await resolveGitHubToken(USER);
    vi.advanceTimersByTime(4 * 60_000);
    await resolveGitHubToken(USER);
    expect(childProcess.execFile).toHaveBeenCalledOnce();

    vi.advanceTimersByTime(60_000);
    await resolveGitHubToken(USER);
    expect(childProcess.execFile).toHaveBeenCalledTimes(2);

    ghByBinary.gh = { kind: "token", stdout: "gho_second" };
    forgetGhToken();
    await expect(resolveGitHubToken(USER)).resolves.toMatchObject({
      value: "gho_second",
    });
    expect(childProcess.execFile).toHaveBeenCalledTimes(3);
  });

  it("asks gh again 30 seconds after finding no login", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    process.env.GH_BIN = "gh";
    ghByBinary.gh = { kind: "signed-out" };

    await resolveGitHubToken(USER);
    vi.advanceTimersByTime(29_000);
    await resolveGitHubToken(USER);
    expect(childProcess.execFile).toHaveBeenCalledOnce();

    ghByBinary.gh = { kind: "token", stdout: "gho_after_login" };
    vi.advanceTimersByTime(1_000);
    await expect(resolveGitHubToken(USER)).resolves.toMatchObject({
      value: "gho_after_login",
      source: "gh",
    });
  });

  it("runs gh once for requests that arrive together", async () => {
    ghByBinary.gh = { kind: "token", stdout: "gho_shared" };

    const tokens = await Promise.all([
      resolveGitHubToken(USER),
      resolveGitHubToken(USER),
      resolveGitHubToken(USER),
    ]);

    expect(tokens.map((token) => token?.value)).toEqual([
      "gho_shared",
      "gho_shared",
      "gho_shared",
    ]);
    expect(childProcess.execFile).toHaveBeenCalledOnce();
  });
});

describe("fetchGitHubLogin", () => {
  it("returns the user a token belongs to, or null when GitHub rejects it", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const authorization = new Headers(init?.headers).get("Authorization");
      return authorization === "Bearer good-token"
        ? Response.json({ login: "miguelvaladez" })
        : Response.json({ message: "Bad credentials" }, { status: 401 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchGitHubLogin("good-token")).resolves.toBe("miguelvaladez");
    await expect(fetchGitHubLogin("bad-token")).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.github.com/user",
      expect.anything(),
    );
  });
});

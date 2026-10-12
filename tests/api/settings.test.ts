// @vitest-environment node
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/drizzle/schema";

const state = vi.hoisted(() => ({ db: undefined as unknown }));

const mockAuth = vi.fn();
vi.mock("@/lib/auth/config", () => ({ auth: mockAuth }));
vi.mock("@/lib/db", () => ({
  get db() {
    return state.db;
  },
}));

const USER = "user-1";
const CODE_LENS_KEY = "editor-code-lens-enabled";
const MINIMAP_KEY = "editor-minimap-enabled";

let sqlite: Database.Database;

function storedSettingValue(key: string): string | undefined {
  const row = sqlite
    .prepare("SELECT value FROM settings WHERE user_id = ? AND key = ?")
    .get(USER, key) as { value: string } | undefined;
  return row?.value;
}

async function putSetting(body: unknown): Promise<Response> {
  const { PUT } = await import("@/app/api/settings/route");
  return PUT(
    new NextRequest("http://localhost:3000/api/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  sqlite = new Database(":memory:");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: "drizzle/migrations" });
  state.db = db;
  sqlite
    .prepare(
      "INSERT INTO users (id, username, password_hash) VALUES (?, ?, 'hash')",
    )
    .run(USER, "user");
  mockAuth.mockResolvedValue({ user: { id: USER } });
});

afterEach(() => {
  sqlite.close();
});

describe("PUT /api/settings editor boolean keys", () => {
  it.each([
    [CODE_LENS_KEY, true],
    [CODE_LENS_KEY, false],
    [MINIMAP_KEY, true],
    [MINIMAP_KEY, false],
  ])("stores %s=%s", async (key, value) => {
    const response = await putSetting({ key, value });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ key, value });
    expect(storedSettingValue(key)).toBe(JSON.stringify(value));
  });

  it.each([
    [CODE_LENS_KEY, "true"],
    [CODE_LENS_KEY, 1],
    [CODE_LENS_KEY, null],
    [MINIMAP_KEY, "false"],
    [MINIMAP_KEY, 0],
    [MINIMAP_KEY, { enabled: true }],
  ])("rejects %s=%j with 400 and stores nothing", async (key, value) => {
    const response = await putSetting({ key, value });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: `Setting '${key}' must be a boolean`,
    });
    expect(storedSettingValue(key)).toBeUndefined();
  });

  it("rejects a missing value for a boolean editor key", async () => {
    const response = await putSetting({ key: MINIMAP_KEY });
    expect(response.status).toBe(400);
    expect(storedSettingValue(MINIMAP_KEY)).toBeUndefined();
  });

  it("keeps accepting non-boolean values for other keys", async () => {
    const response = await putSetting({ key: "editor-type", value: "neovim" });
    expect(response.status).toBe(200);
    expect(storedSettingValue("editor-type")).toBe(JSON.stringify("neovim"));
  });

  it("returns stored editor booleans from GET", async () => {
    await putSetting({ key: CODE_LENS_KEY, value: true });
    await putSetting({ key: MINIMAP_KEY, value: false });
    const { GET } = await import("@/app/api/settings/route");
    const response = await GET();
    expect(await response.json()).toEqual({
      [CODE_LENS_KEY]: true,
      [MINIMAP_KEY]: false,
    });
  });
});

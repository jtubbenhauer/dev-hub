import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { NextRequest } from "next/server";

const { mockAuth, mockWhere } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockWhere: vi.fn(),
}));

vi.mock("@/lib/auth/config", () => ({ auth: mockAuth }));
vi.mock("@/lib/db", () => ({
  db: { select: () => ({ from: () => ({ where: mockWhere }) }) },
}));
vi.mock("@/drizzle/schema", () => ({
  workspaces: { id: "id", userId: "userId" },
}));
vi.mock("@/lib/workspaces/remote-reachability", () => ({
  isRemoteHostReachable: vi.fn().mockResolvedValue(true),
}));
vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a, b) => ({ eq: [a, b] })),
  and: vi.fn((...args) => ({ and: args })),
}));

import { GET } from "@/app/api/files/content/route";

let workspaceDir: string;

function request(query: string): NextRequest {
  return new NextRequest(`http://localhost/api/files/content?${query}`);
}

function workspaceRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "ws-1",
    name: "ws",
    backend: "local",
    path: workspaceDir,
    quickCommands: null,
    providerMeta: null,
    linkedTaskMeta: null,
    ...overrides,
  };
}

beforeAll(() => {
  workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "content-route-"));
  fs.writeFileSync(path.join(workspaceDir, "notes.txt"), "hello");
  fs.writeFileSync(
    path.join(workspaceDir, "archive.zip"),
    Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]),
  );
  fs.writeFileSync(
    path.join(workspaceDir, "huge.log"),
    Buffer.alloc(5 * 1024 * 1024 + 1, "a"),
  );
});

afterAll(() => {
  fs.rmSync(workspaceDir, { recursive: true, force: true });
});

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { id: "user-1" } });
  mockWhere.mockResolvedValue([workspaceRow()]);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GET /api/files/content", () => {
  it("returns text content", async () => {
    const res = await GET(request("workspaceId=ws-1&path=notes.txt"));
    expect(res.status).toBe(200);
    expect((await res.json()).content).toBe("hello");
  });

  it("returns 415 for binary files", async () => {
    const res = await GET(request("workspaceId=ws-1&path=archive.zip"));
    expect(res.status).toBe(415);
  });

  it("returns 413 for files over the editor size limit", async () => {
    const res = await GET(request("workspaceId=ws-1&path=huge.log"));
    expect(res.status).toBe(413);
  });

  it("returns 415 when a remote agent reports a binary file", async () => {
    mockWhere.mockResolvedValue([
      workspaceRow({
        backend: "remote",
        agentUrl: "http://agent:7500",
        opencodeUrl: "http://opencode:4096",
      }),
    ]);
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json(
            { error: "Binary file cannot be displayed" },
            { status: 400 },
          ),
        ),
    );

    const res = await GET(request("workspaceId=ws-1&path=archive.zip"));

    expect(res.status).toBe(415);
  });
});

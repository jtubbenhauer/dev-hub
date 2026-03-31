import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockAuth = vi.fn();
vi.mock("@/lib/auth/config", () => ({ auth: mockAuth }));

const mockRun = vi.fn();
const mockOnConflictDoUpdate = vi.fn().mockReturnValue({ run: mockRun });
const mockValues = vi.fn().mockReturnValue({
  onConflictDoUpdate: mockOnConflictDoUpdate,
});
const mockInsertReturn = { values: mockValues };
const mockInsert = vi.fn().mockReturnValue(mockInsertReturn);

const mockDeleteWhere = vi.fn().mockReturnValue({ run: mockRun });
const mockDelete = vi.fn().mockReturnValue({ where: mockDeleteWhere });

const mockTransaction = vi.fn((cb: (tx: unknown) => void) => {
  cb({ insert: mockInsert, delete: mockDelete });
});

vi.mock("@/lib/db", () => ({
  db: {
    transaction: mockTransaction,
  },
}));

vi.mock("@/drizzle/schema", () => ({
  cachedSessions: {
    id: "cs_id",
    workspaceId: "cs_workspaceId",
    userId: "cs_userId",
  },
  cachedMessages: {
    sessionId: "cm_sessionId",
    workspaceId: "cm_workspaceId",
    userId: "cm_userId",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a, b) => ({ eq: [a, b] })),
  and: vi.fn((...args) => ({ and: args })),
  notInArray: vi.fn((col, vals) => ({ notInArray: [col, vals] })),
}));

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost:3000/api/sessions/cache", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

describe("POST /api/sessions/cache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ user: { id: "user-1" } });
    mockOnConflictDoUpdate.mockReturnValue({ run: mockRun });
    mockValues.mockReturnValue({
      onConflictDoUpdate: mockOnConflictDoUpdate,
    });
    mockInsert.mockReturnValue(mockInsertReturn);
    mockDelete.mockReturnValue({ where: mockDeleteWhere });
    mockDeleteWhere.mockReturnValue({ run: mockRun });
  });

  it("deletes orphaned cachedMessages when syncing sessions", async () => {
    const { POST } = await import("@/app/api/sessions/cache/route");

    const req = makeRequest({
      workspaceId: "ws-1",
      sessions: [
        { id: "s1", time: { created: 1, updated: 2 } },
        { id: "s2", time: { created: 3, updated: 4 } },
      ],
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    expect(mockTransaction).toHaveBeenCalledOnce();
    expect(mockDelete).toHaveBeenCalledTimes(2);

    const { notInArray } = await import("drizzle-orm");

    expect(mockDelete).toHaveBeenNthCalledWith(1, {
      id: "cs_id",
      workspaceId: "cs_workspaceId",
      userId: "cs_userId",
    });

    expect(mockDelete).toHaveBeenNthCalledWith(2, {
      sessionId: "cm_sessionId",
      workspaceId: "cm_workspaceId",
      userId: "cm_userId",
    });

    expect(notInArray).toHaveBeenCalledWith("cm_sessionId", ["s1", "s2"]);
  });

  it("deletes all cachedMessages when no sessions remain", async () => {
    const { POST } = await import("@/app/api/sessions/cache/route");

    const req = makeRequest({
      workspaceId: "ws-1",
      sessions: [],
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    expect(mockDelete).toHaveBeenCalledTimes(2);

    expect(mockDelete).toHaveBeenNthCalledWith(2, {
      sessionId: "cm_sessionId",
      workspaceId: "cm_workspaceId",
      userId: "cm_userId",
    });

    const { notInArray } = await import("drizzle-orm");
    const notInArrayCalls = vi.mocked(notInArray).mock.calls;
    const messageNotInArrayCalls = notInArrayCalls.filter(
      ([col]) => (col as unknown as string) === "cm_sessionId",
    );
    expect(messageNotInArrayCalls).toHaveLength(0);
  });
});

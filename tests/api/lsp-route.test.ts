import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import type { LspServerManager as LspServerManagerType } from "@/lib/lsp/server-manager";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  where: vi.fn(),
  ensureLspWsServer: vi.fn(),
  managerRef: { current: null as LspServerManagerType | null },
}));

vi.mock("@/lib/auth/config", () => ({ auth: mocks.auth }));

vi.mock("@/lib/db", () => ({
  db: { select: () => ({ from: () => ({ where: mocks.where }) }) },
}));

vi.mock("@/drizzle/schema", () => ({
  workspaces: { id: "id", userId: "userId" },
}));

vi.mock("drizzle-orm", () => ({
  eq: (column: unknown, value: unknown) => ({ eq: [column, value] }),
  and: (...conditions: unknown[]) => ({ and: conditions }),
}));

vi.mock("@/lib/lsp/server-manager", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/lsp/server-manager")>();
  return {
    ...actual,
    getLspServerManager: () => {
      if (!mocks.managerRef.current) throw new Error("No test manager");
      return mocks.managerRef.current;
    },
  };
});

vi.mock("@/lib/lsp/ws-server", () => ({
  ensureLspWsServer: mocks.ensureLspWsServer,
}));

import { GET, POST } from "@/app/api/lsp/route";
import { LspBusyError, LspServerManager } from "@/lib/lsp/server-manager";

const localWorkspace = {
  id: "ws-1",
  userId: "user-1",
  path: "/repo/local",
  backend: "local",
};
const remoteWorkspace = { ...localWorkspace, backend: "remote" };
const stoppedStatus = {
  workspaceId: "ws-1",
  serverEpoch: null,
  state: "stopped",
  wsUrl: null,
  error: null,
};

let manager: LspServerManager;
let originalExitListeners = process.listeners("exit");

function getRequest(query: string) {
  return new NextRequest(`http://localhost/api/lsp${query}`);
}

function postRequest(body: unknown) {
  return new NextRequest("http://localhost/api/lsp", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  originalExitListeners = process.listeners("exit");
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: "user-1" } });
  mocks.where.mockResolvedValue([localWorkspace]);
  mocks.ensureLspWsServer.mockResolvedValue({ port: 7601 });
  manager = new LspServerManager();
  mocks.managerRef.current = manager;
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const listener of process.listeners("exit")) {
    if (!originalExitListeners.includes(listener))
      process.removeListener("exit", listener);
  }
});

describe("authentication and lookup", () => {
  it("returns 401 for an unauthenticated GET", async () => {
    mocks.auth.mockResolvedValue(null);

    const response = await GET(getRequest("?workspaceId=ws-1"));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: "Unauthorized",
      code: "UNAUTHORIZED",
    });
  });

  it("returns 401 for an unauthenticated POST", async () => {
    mocks.auth.mockResolvedValue({ user: {} });

    const response = await POST(
      postRequest({ action: "start", workspaceId: "ws-1" }),
    );

    expect(response.status).toBe(401);
    expect((await response.json()).code).toBe("UNAUTHORIZED");
    expect(mocks.where).not.toHaveBeenCalled();
  });

  it("returns 404 for a workspace the user does not own", async () => {
    mocks.where.mockResolvedValue([]);

    const response = await GET(getRequest("?workspaceId=ws-1"));

    expect(response.status).toBe(404);
    expect((await response.json()).code).toBe("NOT_FOUND");
    expect(mocks.where).toHaveBeenCalledWith({
      and: [{ eq: ["id", "ws-1"] }, { eq: ["userId", "user-1"] }],
    });
  });

  it("returns 400 REMOTE_WORKSPACE for a remote GET", async () => {
    mocks.where.mockResolvedValue([remoteWorkspace]);

    const response = await GET(getRequest("?workspaceId=ws-1"));

    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("REMOTE_WORKSPACE");
  });

  it("returns 400 REMOTE_WORKSPACE for a remote POST", async () => {
    mocks.where.mockResolvedValue([remoteWorkspace]);
    const start = vi.spyOn(manager, "start");

    const response = await POST(
      postRequest({ action: "start", workspaceId: "ws-1" }),
    );

    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("REMOTE_WORKSPACE");
    expect(start).not.toHaveBeenCalled();
  });
});

describe("request validation", () => {
  it("returns 400 when GET has no workspaceId", async () => {
    const response = await GET(getRequest(""));

    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("INVALID_REQUEST");
  });

  it("returns 400 for a body that is not JSON", async () => {
    const response = await POST(postRequest("{not json"));

    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("INVALID_REQUEST");
  });

  it("returns 400 for an unknown action", async () => {
    const response = await POST(
      postRequest({ action: "restart", workspaceId: "ws-1" }),
    );

    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("INVALID_REQUEST");
  });

  it("returns 400 when POST has no workspaceId", async () => {
    const response = await POST(postRequest({ action: "start" }));

    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("INVALID_REQUEST");
  });
});

describe("GET status", () => {
  it("returns the stopped status with a null wsUrl", async () => {
    const response = await GET(getRequest("?workspaceId=ws-1"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(stoppedStatus);
    expect(mocks.ensureLspWsServer).toHaveBeenCalledWith(manager);
  });

  it("returns 500 LSP_PORT_UNAVAILABLE when the port is unavailable", async () => {
    mocks.ensureLspWsServer.mockRejectedValue(
      new Error("LSP port 7601 in use"),
    );

    const response = await GET(getRequest("?workspaceId=ws-1"));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "LSP port 7601 in use",
      code: "LSP_PORT_UNAVAILABLE",
    });
  });
});

describe("POST start", () => {
  it("starts the manager with the workspace path and returns its wsUrl", async () => {
    const start = vi
      .spyOn(manager, "start")
      .mockImplementation(async ({ workspaceId }) => {
        manager.workspaceId = workspaceId;
        manager.state = "running";
        manager.epoch = 3;
      });

    const response = await POST(
      postRequest({ action: "start", workspaceId: "ws-1" }),
    );

    expect(response.status).toBe(200);
    expect(start).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      workspacePath: "/repo/local",
    });
    expect(await response.json()).toEqual({
      workspaceId: "ws-1",
      serverEpoch: 3,
      state: "running",
      wsUrl: "ws://127.0.0.1:7601/?workspaceId=ws-1&epoch=3",
      error: null,
    });
  });

  it("returns 409 LSP_BUSY when another session holds the server", async () => {
    vi.spyOn(manager, "start").mockRejectedValue(new LspBusyError());

    const response = await POST(
      postRequest({ action: "start", workspaceId: "ws-1" }),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "LSP is in use by another session",
      code: "LSP_BUSY",
    });
  });

  it("returns 500 with the message when start fails otherwise", async () => {
    vi.spyOn(manager, "start").mockRejectedValue(
      new Error("previous vtsls process (pid 42) did not exit"),
    );

    const response = await POST(
      postRequest({ action: "start", workspaceId: "ws-1" }),
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "previous vtsls process (pid 42) did not exit",
    });
  });

  it("returns 500 LSP_PORT_UNAVAILABLE without starting when the port is unavailable", async () => {
    mocks.ensureLspWsServer.mockRejectedValue(
      new Error("LSP port 7601 in use"),
    );
    const start = vi.spyOn(manager, "start");

    const response = await POST(
      postRequest({ action: "start", workspaceId: "ws-1" }),
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "LSP port 7601 in use",
      code: "LSP_PORT_UNAVAILABLE",
    });
    expect(start).not.toHaveBeenCalled();
  });
});

describe("POST stop", () => {
  it("stops the matching workspace without touching the WebSocket server", async () => {
    mocks.ensureLspWsServer.mockRejectedValue(
      new Error("LSP port 7601 in use"),
    );
    manager.workspaceId = "ws-1";
    const stop = vi.spyOn(manager, "stop");

    const response = await POST(
      postRequest({ action: "stop", workspaceId: "ws-1" }),
    );

    expect(response.status).toBe(200);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(mocks.ensureLspWsServer).not.toHaveBeenCalled();
    expect(await response.json()).toEqual(stoppedStatus);
  });

  it("does not stop a different workspace", async () => {
    manager.workspaceId = "ws-other";
    const stop = vi.spyOn(manager, "stop");

    const response = await POST(
      postRequest({ action: "stop", workspaceId: "ws-1" }),
    );

    expect(response.status).toBe(200);
    expect(stop).not.toHaveBeenCalled();
    expect(mocks.ensureLspWsServer).not.toHaveBeenCalled();
    expect(await response.json()).toEqual(stoppedStatus);
  });

  it("returns 500 with the message when stop fails", async () => {
    manager.workspaceId = "ws-1";
    vi.spyOn(manager, "stop").mockRejectedValue(
      new Error("vtsls (pid 42) did not exit after SIGKILL"),
    );

    const response = await POST(
      postRequest({ action: "stop", workspaceId: "ws-1" }),
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "vtsls (pid 42) did not exit after SIGKILL",
    });
  });
});

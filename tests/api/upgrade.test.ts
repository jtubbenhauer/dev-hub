// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { EventEmitter } from "node:events";
import type { Workspace } from "@/types";

const {
  mockAuth,
  mockWhere,
  mockFrom,
  mockSelect,
  mockToWorkspace,
  mockSpawn,
} = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockWhere: vi.fn(),
  mockFrom: vi.fn(),
  mockSelect: vi.fn(),
  mockToWorkspace: vi.fn(),
  mockSpawn: vi.fn(),
}));

const mockDbChain = { from: mockFrom, where: mockWhere };

vi.mock("@/lib/auth/config", () => ({ auth: mockAuth }));

vi.mock("@/lib/db", () => ({ db: { select: mockSelect } }));

vi.mock("@/drizzle/schema", () => ({
  workspaces: { id: "id", userId: "userId" },
  settings: { userId: "userId", key: "key" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a, b) => ({ eq: [a, b] })),
  and: vi.fn((...args) => ({ and: args })),
}));

vi.mock("@/lib/workspaces/backend", () => ({
  toWorkspace: (...args: unknown[]) => mockToWorkspace(...args),
}));

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    spawn: mockSpawn,
    __esModule: true,
    default: { spawn: mockSpawn },
  };
});

const rigProvider = {
  id: "provider-1",
  name: "rig-cli",
  binaryPath: "/usr/local/bin/rig-cli",
  commands: {
    create: "{binary} create",
    destroy: "{binary} destroy",
    status: "{binary} status --json",
    upgrade: "{binary} upgrade {id}",
  },
};

const remoteRow = {
  id: "ws-remote",
  userId: "user-1",
  backend: "remote",
};

function remoteWorkspace(): Workspace {
  return {
    id: "ws-remote",
    userId: "user-1",
    name: "fix-invoices",
    path: "/home/dev/code",
    type: "repo",
    parentRepoPath: null,
    packageManager: null,
    quickCommands: null,
    backend: "remote",
    provider: "rig-cli",
    opencodeUrl: null,
    agentUrl: null,
    providerMeta: {
      providerId: "provider-1",
      providerWorkspaceId: "69-oc-fix-invoices",
    },
    shellCommand: null,
    sshTarget: null,
    sshPath: null,
    worktreeSymlinks: null,
    linkedTaskId: null,
    linkedTaskMeta: null,
    color: null,
    createdAt: new Date(),
    lastAccessedAt: new Date(),
  };
}

function makeChildProcess(
  output: { stdout?: string; stderr?: string },
  exitCode: number,
  delayMs = 0,
) {
  const child = new EventEmitter();
  const stdoutEmitter = new EventEmitter();
  const stderrEmitter = new EventEmitter();
  Object.assign(child, { stdout: stdoutEmitter, stderr: stderrEmitter });
  setTimeout(() => {
    if (output.stdout) stdoutEmitter.emit("data", Buffer.from(output.stdout));
    if (output.stderr) stderrEmitter.emit("data", Buffer.from(output.stderr));
    child.emit("close", exitCode);
  }, delayMs);
  return child;
}

function makeRequest(id: string): NextRequest {
  return new NextRequest(`http://localhost:3000/api/workspaces/${id}/upgrade`, {
    method: "POST",
  });
}

function givenWorkspaceAndProviders(providers: unknown[]) {
  mockWhere
    .mockResolvedValueOnce([remoteRow])
    .mockResolvedValueOnce([{ value: providers }]);
  mockToWorkspace.mockReturnValueOnce(remoteWorkspace());
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { id: "user-1" } });
  mockSelect.mockReturnValue(mockDbChain);
  mockFrom.mockReturnValue(mockDbChain);
  mockWhere.mockResolvedValue([]);
});

describe("POST /api/workspaces/[id]/upgrade", () => {
  let POST: (
    request: NextRequest,
    context: { params: Promise<{ id: string }> },
  ) => Promise<Response>;

  beforeEach(async () => {
    POST = (await import("@/app/api/workspaces/[id]/upgrade/route")).POST;
  });

  function callUpgrade(id: string) {
    return POST(makeRequest(id), { params: Promise.resolve({ id }) });
  }

  it("returns 401 when not authenticated", async () => {
    mockAuth.mockResolvedValueOnce(null);
    const response = await callUpgrade("ws-remote");
    expect(response.status).toBe(401);
  });

  it("returns 404 when the workspace does not exist", async () => {
    const response = await callUpgrade("ws-missing");
    expect(response.status).toBe(404);
  });

  it("returns 400 when the provider has no upgrade command", async () => {
    const { upgrade: _upgrade, ...commandsWithoutUpgrade } =
      rigProvider.commands;
    givenWorkspaceAndProviders([
      { ...rigProvider, commands: commandsWithoutUpgrade },
    ]);

    const response = await callUpgrade("ws-remote");
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("does not support upgrade");
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it("runs the provider's upgrade command for the workspace's container", async () => {
    givenWorkspaceAndProviders([rigProvider]);
    mockSpawn.mockImplementationOnce(() =>
      makeChildProcess(
        {
          stdout:
            "- 69-oc-fix-invoices: recreating...\nUpgrade complete: 1 upgraded, 0 failed.\n",
        },
        0,
      ),
    );

    const response = await callUpgrade("ws-remote");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "upgraded",
      summary: "Upgrade complete: 1 upgraded, 0 failed.",
    });
    expect(mockSpawn).toHaveBeenCalledWith(
      "sh",
      ["-c", "/usr/local/bin/rig-cli upgrade 69-oc-fix-invoices"],
      expect.objectContaining({ timeout: expect.any(Number) }),
    );
  });

  it("returns 500 with the command's error when the upgrade fails", async () => {
    givenWorkspaceAndProviders([rigProvider]);
    mockSpawn.mockImplementationOnce(() =>
      makeChildProcess(
        { stderr: "Error: 1 of 1 containers failed to upgrade\n" },
        1,
      ),
    );

    const response = await callUpgrade("ws-remote");
    expect(response.status).toBe(500);
    expect((await response.json()).error).toBe(
      "Upgrade command exited with code 1: Error: 1 of 1 containers failed to upgrade",
    );
  });

  it("returns 409 while the same workspace is already upgrading", async () => {
    givenWorkspaceAndProviders([rigProvider]);
    givenWorkspaceAndProviders([rigProvider]);
    let finishFirstUpgrade: () => void = () => {};
    mockSpawn.mockImplementationOnce(() => {
      const child = new EventEmitter();
      Object.assign(child, {
        stdout: new EventEmitter(),
        stderr: new EventEmitter(),
      });
      finishFirstUpgrade = () => child.emit("close", 0);
      return child;
    });

    const firstUpgrade = callUpgrade("ws-remote");
    await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalledTimes(1));

    const secondResponse = await callUpgrade("ws-remote");
    expect(secondResponse.status).toBe(409);

    finishFirstUpgrade();
    expect((await firstUpgrade).status).toBe(200);
  });
});

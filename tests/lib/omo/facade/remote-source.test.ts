// @vitest-environment node

import { drizzle } from "drizzle-orm/better-sqlite3";
import { realpath, rm } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/drizzle/schema";
import { createRegistryTestDatabase } from "@/tests/lib/omo/session-registry-db-fixture";

vi.mock("node:fs/promises", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs/promises")>()),
  realpath: vi.fn(async () => {
    throw new TypeError("Remote workspaces must not call fs.realpath");
  }),
  rm: vi.fn(async () => undefined),
}));

const sqliteDatabases: ReturnType<typeof createRegistryTestDatabase>[] = [];

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function authorizationHeader(init?: RequestInit): string | null {
  return new Headers(init?.headers).get("Authorization");
}

function useTestDatabase(workspaceIds: readonly string[]): void {
  const sqlite = createRegistryTestDatabase();
  sqliteDatabases.push(sqlite);
  for (const workspaceId of workspaceIds) {
    sqlite
      .prepare("INSERT OR IGNORE INTO workspaces VALUES (?, 'user-1')")
      .run(workspaceId);
  }
  vi.doMock("@/lib/db", () => ({ db: drizzle(sqlite, { schema }) }));
}

async function stubRemoteRegistryClient(
  runtime: Awaited<
    ReturnType<
      (typeof import("@/lib/omo/runtime"))["getOmoRuntimeForWorkspace"]
    >
  >["runtime"],
) {
  vi.spyOn(runtime.client, "connect").mockResolvedValue({
    protocolVersion: 1,
    mode: "multi",
    capabilities: [],
  });
  vi.spyOn(runtime.client, "request").mockResolvedValue({
    data: { entries: [], leafId: null },
  });
  let openCount = 0;
  const openSession = vi
    .spyOn(runtime.client, "openSession")
    .mockImplementation(async (_params, onBound) => {
      openCount += 1;
      const opened = {
        sessionId: `route-${openCount}`,
        state: {
          sessionId: `durable-${openCount}`,
          sessionFile: `/sessions/durable-${openCount}.jsonl`,
          sessionName: `Session ${openCount}`,
          status: "idle",
          isStreaming: false,
        },
      };
      onBound(opened, [], false);
      return opened;
    });
  return openSession;
}

beforeEach(() => {
  vi.stubEnv("DEVHUB_AGENT_ALLOWED_ORIGINS", "https://agent.example");
});

afterEach(() => {
  vi.unstubAllEnvs();
  for (const runtime of globalThis.__devhubOmo?.values() ?? []) {
    runtime.registry.dispose();
    runtime.client.close();
  }
  globalThis.__devhubOmo = undefined;
  for (const sqlite of sqliteDatabases.splice(0)) sqlite.close();
  vi.doUnmock("@/lib/db");
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("RemoteAgentSessionSource", () => {
  it("lists remote sessions through the authenticated facade source", async () => {
    vi.resetModules();
    useTestDatabase(["workspace-1"]);
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      expect(requestUrl(input)).toBe("https://agent.example/omo/sessions");
      expect(authorizationHeader(init)).toBe("Bearer agent-token");
      return Response.json([
        {
          durableId: "remote-1",
          sessionPath: "/agent/sessions/remote-1.jsonl",
          forkedFrom: null,
          title: "Remote session",
          createdMs: 10,
          updatedMs: 20,
        },
      ]);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { getOmoRuntimeForWorkspace } = await import("@/lib/omo/runtime");
    const { listOmoSessions } = await import("@/lib/omo/facade/read-sessions");
    const workspace = {
      id: "workspace-1",
      path: "/informational-only",
      backend: "remote" as const,
      agentUrl: "https://agent.example",
    };
    const context = getOmoRuntimeForWorkspace(workspace, "agent-token");

    const response = await listOmoSessions({ ...context, workspace });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject([
      { id: "omo_remote-1", title: "Remote session" },
    ]);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(realpath).not.toHaveBeenCalled();
    expect(rm).not.toHaveBeenCalled();
  });

  it("treats probe deletion as idempotent but ordinary deletion as not found", async () => {
    vi.resetModules();
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({ error: "Session not found" }, { status: 404 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { RemoteAgentSessionSource } =
      await import("@/lib/omo/remote-session-source");
    const { OmoNotFoundError } = await import("@/lib/omo/session-source");
    const source = new RemoteAgentSessionSource({
      sessionsUrl: "https://agent.example/omo/sessions",
      token: "agent-token",
    });

    await expect(
      source.removeProbeSession("probe-1", "/ignored.jsonl"),
    ).resolves.toBeUndefined();
    await expect(source.remove("missing-1")).rejects.toBeInstanceOf(
      OmoNotFoundError,
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(requestUrl(fetchMock.mock.calls[0]?.[0] ?? "")).toBe(
      "https://agent.example/omo/sessions/probe-1",
    );
    expect(authorizationHeader(fetchMock.mock.calls[0]?.[1])).toBe(
      "Bearer agent-token",
    );
    expect(rm).not.toHaveBeenCalled();
  });

  it("never sends the agent token to an origin outside the allowlist", async () => {
    vi.resetModules();
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json([]));
    vi.stubGlobal("fetch", fetchMock);
    const { RemoteAgentSessionSource } =
      await import("@/lib/omo/remote-session-source");
    const { OmoTransportGoneError } = await import("@/lib/omo/errors");
    const source = new RemoteAgentSessionSource({
      sessionsUrl: "https://attacker.example/omo/sessions",
      token: "agent-token",
    });

    await expect(source.list()).rejects.toBeInstanceOf(OmoTransportGoneError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shares one dialog ledger between the remote registry and the facade", async () => {
    vi.resetModules();
    const { getOmoRuntimeForWorkspace } = await import("@/lib/omo/runtime");
    const { getOmoDialogLedger } =
      await import("@/lib/omo/facade/read-runtime");
    const { runtime } = getOmoRuntimeForWorkspace(
      {
        id: "workspace-1",
        path: "/informational-only",
        backend: "remote",
        agentUrl: "https://agent.example",
      },
      "agent-token",
    );

    expect(getOmoDialogLedger(runtime)).toBe(runtime.registry.dialogLedger);
  });

  it("refuses to build a remote runtime for an untrusted agentUrl", async () => {
    vi.resetModules();
    const { getOmoRuntimeForWorkspace } = await import("@/lib/omo/runtime");
    const { OmoTransportGoneError } = await import("@/lib/omo/errors");

    expect(() =>
      getOmoRuntimeForWorkspace(
        {
          id: "workspace-1",
          path: "/informational-only",
          backend: "remote",
          agentUrl: "http://10.0.0.1:7500",
        },
        "agent-token",
      ),
    ).toThrow(OmoTransportGoneError);
  });
});

describe("facade context routing by backend", () => {
  it("routes createOmoReadContext and createOmoWriteContext to the remote source and never touches fs", async () => {
    vi.resetModules();
    useTestDatabase(["workspace-1"]);
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json([]));
    vi.stubGlobal("fetch", fetchMock);
    const { createOmoReadContext } =
      await import("@/lib/omo/facade/read-runtime");
    const { createOmoWriteContext } =
      await import("@/lib/omo/facade/write-runtime");
    const { RemoteAgentSessionSource } =
      await import("@/lib/omo/remote-session-source");
    const { LocalFsSessionSource } = await import("@/lib/omo/session-source");
    const workspace = {
      id: "workspace-1",
      path: "/informational-only",
      backend: "remote" as const,
      agentUrl: "https://agent.example",
    };

    const readContext = createOmoReadContext(workspace);
    const writeContext = createOmoWriteContext(workspace);
    await readContext.source.list();

    expect(readContext.source).toBeInstanceOf(RemoteAgentSessionSource);
    expect(readContext.source).not.toBeInstanceOf(LocalFsSessionSource);
    expect(writeContext.source).toBeInstanceOf(RemoteAgentSessionSource);
    expect(writeContext.source).not.toBeInstanceOf(LocalFsSessionSource);
    expect(readContext.runtime).toBe(writeContext.runtime);
    expect(fetchMock).toHaveBeenCalled();
    expect(realpath).not.toHaveBeenCalled();
  });

  it("authorizes a remote session only when it appears in the sidecar's scoped listing", async () => {
    vi.resetModules();
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json([
        {
          durableId: "listed",
          sessionPath: "/agent/sessions/listed.jsonl",
          forkedFrom: null,
          title: "Listed",
          createdMs: 1,
          updatedMs: 2,
        },
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { RemoteAgentSessionSource } =
      await import("@/lib/omo/remote-session-source");
    const source = new RemoteAgentSessionSource({
      sessionsUrl: "https://agent.example/omo/sessions",
      token: "agent-token",
    });

    await expect(source.authorizeSession("listed")).resolves.toBe(true);
    await expect(source.authorizeSession("unlisted")).resolves.toBe(false);
  });
});

describe("remote workspace canonical paths", () => {
  it("rejects a second workspace when the sidecar reports the same path", async () => {
    vi.resetModules();
    useTestDatabase(["workspace-1", "workspace-2"]);
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => Response.json({ path: "/canonical" })),
    );
    const { getOmoRuntimeForWorkspace } = await import("@/lib/omo/runtime");
    const firstWorkspace = {
      id: "workspace-1",
      path: "/reported-one",
      backend: "remote" as const,
      agentUrl: "https://agent.example",
    };
    const secondWorkspace = { ...firstWorkspace, id: "workspace-2" };
    const { runtime } = getOmoRuntimeForWorkspace(
      firstWorkspace,
      "agent-token",
    );
    const openSession = await stubRemoteRegistryClient(runtime);
    await runtime.registry.create({ workspace: firstWorkspace });

    await expect(
      runtime.registry.create({ workspace: secondWorkspace }),
    ).rejects.toMatchObject({
      name: "OmoWorkspacePathConflictError",
      owningWorkspaceId: "workspace-1",
      requestedWorkspaceId: "workspace-2",
    });
    expect(openSession).toHaveBeenCalledOnce();
    expect(realpath).not.toHaveBeenCalled();
  });

  it("observes a changed sidecar realpath on the next attach", async () => {
    vi.resetModules();
    useTestDatabase(["workspace-1", "workspace-2"]);
    let canonicalPath = "/mount/before-restart";
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({ path: canonicalPath }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { getOmoRuntimeForWorkspace } = await import("@/lib/omo/runtime");
    const firstWorkspace = {
      id: "workspace-1",
      path: "/reported-one",
      backend: "remote" as const,
      agentUrl: "https://agent.example",
    };
    const secondWorkspace = { ...firstWorkspace, id: "workspace-2" };
    const { runtime } = getOmoRuntimeForWorkspace(
      firstWorkspace,
      "agent-token",
    );
    const openSession = await stubRemoteRegistryClient(runtime);
    await runtime.registry.create({ workspace: firstWorkspace });
    canonicalPath = "/mount/after-restart";

    await expect(
      runtime.registry.create({ workspace: secondWorkspace }),
    ).resolves.toMatchObject({ workspaceId: "workspace-2" });
    expect(openSession).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(realpath).not.toHaveBeenCalled();
  });

  it("maps a realpath failure to engine unavailable without opening", async () => {
    vi.resetModules();
    useTestDatabase(["workspace-1"]);
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () =>
        Response.json({ error: "failed" }, { status: 500 }),
      ),
    );
    const { OmoTransportGoneError } = await import("@/lib/omo/errors");
    const { responseForOmoReadError } =
      await import("@/lib/omo/facade/read-errors");
    const { getOmoRuntimeForWorkspace } = await import("@/lib/omo/runtime");
    const workspace = {
      id: "workspace-1",
      path: "/reported",
      backend: "remote" as const,
      agentUrl: "https://agent.example",
    };
    const { runtime } = getOmoRuntimeForWorkspace(workspace, "agent-token");
    const openSession = await stubRemoteRegistryClient(runtime);

    let failure: unknown;
    try {
      await runtime.registry.create({ workspace });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(OmoTransportGoneError);
    const response = responseForOmoReadError(failure);
    expect(response?.status).toBe(503);
    await expect(response?.json()).resolves.toEqual({
      error: "engine_unavailable",
    });
    expect(openSession).not.toHaveBeenCalled();
    expect(realpath).not.toHaveBeenCalled();
  });
});

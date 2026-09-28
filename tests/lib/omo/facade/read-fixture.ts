import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, vi } from "vitest";
import * as schema from "@/drizzle/schema";
import type { OmoCatalog } from "@/lib/omo/adapter/catalog";
import type { JsonlRecord } from "@/lib/omo/jsonl";
import type { SessionSource } from "@/lib/omo/session-source";
import type {
  OmoSessionOnDiskSummary,
  SessionEntry,
} from "@/lib/omo/sessions-on-disk";
import { createRegistryTestDatabase } from "@/tests/lib/omo/session-registry-db-fixture";

export class MemorySessionSource implements SessionSource {
  readonly summaries: OmoSessionOnDiskSummary[] = [];
  readonly entries = new Map<string, readonly SessionEntry[]>();
  readonly authorized = new Set<string>();
  readonly list = vi.fn(async () => this.summaries);
  readonly readEntries = vi.fn(async (rawId: string) => {
    return this.entries.get(rawId) ?? [];
  });
  readonly remove = vi.fn(async () => undefined);
  readonly removeProbeSession = vi.fn(async () => undefined);
  readonly canonicalWorkspacePath = vi.fn(async () => "/workspace");
  readonly authorizeSession = vi.fn(async (rawId: string) => {
    return this.authorized.has(rawId);
  });
}

export type TestBinding = {
  readonly durableId: string;
  readonly routingHandle: string;
  readonly openedState: {
    readonly isStreaming: boolean;
    readonly record: JsonlRecord;
  };
  readonly ready: Promise<void>;
  readonly state: "live";
  readonly workspaceId: string;
};

export function createBinding(
  durableId: string,
  state: JsonlRecord = {},
  isStreaming = false,
): TestBinding {
  return {
    durableId,
    routingHandle: `route-${durableId}`,
    openedState: { isStreaming, record: state },
    ready: Promise.resolve(),
    state: "live",
    workspaceId: "workspace-1",
  };
}

const defaultCatalog: OmoCatalog = {
  providers: { providers: [], default: {} },
  agents: [],
  commands: [],
  mcp: {},
};

export async function createReadFixture() {
  vi.resetModules();
  const sqlite = createRegistryTestDatabase();
  const source = new MemorySessionSource();
  const binding = createBinding("root");
  const client = {
    isConnected: false,
    connect: vi.fn(async () => ({
      protocolVersion: 1,
      mode: "multi",
      capabilities: [],
      serverVersion: "test-host",
    })),
    request: vi.fn(
      async (): Promise<JsonlRecord> => ({
        data: { sessions: [] },
      }),
    ),
  };
  const registry = {
    attach: vi.fn(async () => binding),
    request: vi.fn(
      async (): Promise<JsonlRecord> => ({
        data: { entries: [], leafId: null },
      }),
    ),
    refreshIndexFromHost: vi.fn(async () => undefined),
    canonicalWorkspacePath: vi.fn(async () => "/workspace"),
    findBinding: vi.fn<
      (
        workspaceId: string,
        durableId: string | undefined,
        sessionPath: string | null,
      ) => TestBinding | undefined
    >(() => undefined),
    bindingsForLifecycle: vi.fn<() => readonly TestBinding[]>(() => []),
    sessionStatusesForWorkspace: vi.fn(() => ({})),
  };
  const runtime = {
    client,
    registry,
    dialogs: new Map<string, unknown>(),
    catalog: new Map<string, unknown>(),
  };
  const getCatalog = vi.fn(async () => defaultCatalog);
  const ensureOmoDaemon = vi.fn(async () => ({
    socket: "/host.sock",
    pid: 1,
    instanceId: "instance",
    engineVersion: "test",
    action: "reuse",
  }));

  vi.doMock("@/lib/db", () => ({ db: drizzle(sqlite, { schema }) }));
  vi.doMock("@/lib/omo/session-registry", () => ({
    getOmoRuntime: () => runtime,
  }));
  vi.doMock("@/lib/omo/session-source", () => ({
    LocalFsSessionSource: vi.fn(function LocalFsSessionSource() {
      return source;
    }),
  }));
  vi.doMock("@/lib/omo/agent-dir", () => ({
    resolveOmoAgentDir: () => "/agent",
    resolveOmoSocketPath: () => "/host.sock",
  }));
  vi.doMock("@/lib/omo/adapter/catalog", () => ({ getCatalog }));
  vi.doMock("@/lib/omo/daemon", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@/lib/omo/daemon")>();
    return { ...actual, ensureOmoDaemon };
  });

  const { handleOmoRead } = await import("@/lib/omo/facade/read");
  const workspace = {
    id: "workspace-1",
    path: "/workspace",
    backend: "local" as const,
  };

  return {
    sqlite,
    source,
    runtime,
    registry,
    client,
    getCatalog,
    ensureOmoDaemon,
    workspace,
    request(
      path: string,
      query: Record<string, string> = {},
      method = "GET",
    ): Promise<Response> {
      return handleOmoRead({
        method,
        path,
        query: new URLSearchParams(query),
        workspace,
        userId: "user-1",
      });
    },
    close(): void {
      sqlite.close();
      vi.doUnmock("@/lib/db");
      vi.doUnmock("@/lib/omo/session-registry");
      vi.doUnmock("@/lib/omo/session-source");
      vi.doUnmock("@/lib/omo/agent-dir");
      vi.doUnmock("@/lib/omo/adapter/catalog");
      vi.doUnmock("@/lib/omo/daemon");
    },
  };
}

export type ReadFixture = Awaited<ReturnType<typeof createReadFixture>>;

const fixtures: ReadFixture[] = [];

export async function useReadFixture(): Promise<ReadFixture> {
  const fixture = await createReadFixture();
  fixtures.push(fixture);
  return fixture;
}

export async function readJson(response: Response): Promise<unknown> {
  return response.json();
}

afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.close();
  vi.restoreAllMocks();
});

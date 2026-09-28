import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, vi } from "vitest";
import * as schema from "@/drizzle/schema";
import { DialogLedger } from "@/lib/omo/dialog-ledger";
import type { JsonlRecord } from "@/lib/omo/jsonl";
import type { SessionSource } from "@/lib/omo/session-source";
import type {
  OmoSessionOnDiskSummary,
  SessionEntry,
} from "@/lib/omo/sessions-on-disk";
import { createRegistryTestDatabase } from "@/tests/lib/omo/session-registry-db-fixture";

export class WriteMemorySessionSource implements SessionSource {
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

export type WriteTestBinding = {
  readonly durableId: string;
  readonly routingHandle: string;
  readonly sessionPath: string | null;
  readonly workspaceId: string;
  readonly workspace: { readonly id: string; readonly path: string };
  readonly openedState: {
    readonly durableId: string;
    readonly sessionPath: string | null;
    readonly title: string;
    readonly isStreaming: boolean;
    readonly modelId: string | undefined;
    readonly providerId: string | undefined;
    readonly record: JsonlRecord;
  };
  readonly ready: Promise<void>;
  readonly state: "live";
};

export function createWriteBinding(
  durableId: string,
  options: {
    readonly isStreaming?: boolean;
    readonly sessionPath?: string | null;
  } = {},
): WriteTestBinding {
  const sessionPath = options.sessionPath ?? `/sessions/${durableId}.jsonl`;
  const workspace = { id: "workspace-1", path: "/workspace" };
  return {
    durableId,
    routingHandle: `route-${durableId}`,
    sessionPath,
    workspaceId: workspace.id,
    workspace,
    openedState: {
      durableId,
      sessionPath,
      title: durableId,
      isStreaming: options.isStreaming ?? false,
      modelId: "current-model",
      providerId: "current-provider",
      record: {},
    },
    ready: Promise.resolve(),
    state: "live",
  };
}

export function namedWriteError(
  name: string,
  fields: Readonly<Record<string, unknown>> = {},
): Error {
  return Object.assign(new Error(name), { name, ...fields });
}

export function insertWriteIndexRow(
  sqlite: import("better-sqlite3").Database,
  values: {
    readonly durableId: string;
    readonly sessionPath?: string | null;
    readonly kind?: "interactive" | "worker";
    readonly parentDurableId?: string | null;
    readonly context?: string | null;
    readonly contextAuthoritative?: number;
    readonly leafKnown?: number;
    readonly leafEntryId?: string | null;
  },
): void {
  sqlite
    .prepare(
      `INSERT INTO omo_session_index
       (workspace_id, durable_id, session_path, parent_durable_id, kind,
        context, context_authoritative, title, created_ms, updated_ms,
        leaf_known, leaf_entry_id, updated_at)
       VALUES ('workspace-1', ?, ?, ?, ?, ?, ?, ?, 10, 20, ?, ?, 30)`,
    )
    .run(
      values.durableId,
      values.sessionPath === undefined
        ? `/sessions/${values.durableId}.jsonl`
        : values.sessionPath,
      values.parentDurableId ?? null,
      values.kind ?? "interactive",
      values.context ?? null,
      values.contextAuthoritative ?? 0,
      values.durableId,
      values.leafKnown ?? 0,
      values.leafEntryId ?? null,
    );
}

export async function createWriteFixture() {
  vi.resetModules();
  const sqlite = createRegistryTestDatabase();
  const source = new WriteMemorySessionSource();
  const binding = createWriteBinding("root");
  const client = {
    isConnected: true,
    connect: vi.fn(async () => ({ protocolVersion: 1 })),
    request: vi.fn(async (): Promise<JsonlRecord> => ({ data: {} })),
    sendFireAndForget: vi.fn((_record: JsonlRecord): void => undefined),
  };
  const registry = {
    create: vi.fn(async () => binding),
    attach: vi.fn(
      async (_request: {
        readonly workspace: { readonly id: string; readonly path: string };
        readonly durableId?: string;
        readonly sessionPath?: string;
      }): Promise<WriteTestBinding> => binding,
    ),
    request: vi.fn(
      async (
        _binding: WriteTestBinding,
        command: JsonlRecord,
      ): Promise<JsonlRecord> => {
        if (command["type"] === "get_state") {
          return {
            data: {
              model: { provider: "current-provider", id: "current-model" },
              isStreaming: false,
            },
          };
        }
        return { data: {} };
      },
    ),
    refreshIndexFromHost: vi.fn(async () => undefined),
    findBinding: vi.fn((): WriteTestBinding | undefined => undefined),
    cleanupBinding: vi.fn(() => undefined),
    enqueueLeaf: vi.fn(
      async (
        _workspaceId: string,
        _durableId: string,
        mutation: () => Promise<void>,
      ) => mutation(),
    ),
    emitEvent: vi.fn(() => undefined),
  };
  const runtime = {
    client,
    registry,
    dialogs: new Map<string, unknown>(),
    catalog: new Map<string, unknown>(),
  };
  const dialogLedger = new DialogLedger();
  runtime.dialogs.set("\0devhub-omo-dialog-ledger", dialogLedger);

  vi.doMock("@/lib/db", () => ({ db: drizzle(sqlite, { schema }) }));
  vi.doMock("@/lib/omo/session-registry", () => ({
    getOmoRuntime: () => runtime,
  }));
  vi.doMock("@/lib/omo/session-source", async (importOriginal) => {
    const actual =
      await importOriginal<typeof import("@/lib/omo/session-source")>();
    return {
      ...actual,
      LocalFsSessionSource: vi.fn(function LocalFsSessionSource() {
        return source;
      }),
    };
  });
  vi.doMock("@/lib/omo/agent-dir", () => ({
    resolveOmoAgentDir: () => "/agent",
    resolveOmoSocketPath: () => "/host.sock",
  }));

  const { handleOmoWrite } = await import("@/lib/omo/facade/write");
  const workspace = {
    id: "workspace-1",
    path: "/workspace",
    backend: "local" as const,
  };
  return {
    sqlite,
    source,
    binding,
    client,
    registry,
    runtime,
    dialogLedger,
    workspace,
    request(
      path: string,
      options: { readonly method?: string; readonly body?: unknown } = {},
    ): Promise<Response> {
      return handleOmoWrite({
        method: options.method ?? "POST",
        path,
        body: options.body,
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
    },
  };
}

export type WriteFixture = Awaited<ReturnType<typeof createWriteFixture>>;

const fixtures: WriteFixture[] = [];

export async function useWriteFixture(): Promise<WriteFixture> {
  const fixture = await createWriteFixture();
  fixtures.push(fixture);
  return fixture;
}

export async function writeJson(response: Response): Promise<unknown> {
  return response.json();
}

afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.close();
  vi.restoreAllMocks();
});

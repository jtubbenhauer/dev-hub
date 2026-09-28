import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, vi } from "vitest";
import * as schema from "@/drizzle/schema";
import type { JsonlRecord } from "@/lib/omo/jsonl";
import type {
  OmoRuntime,
  OmoSessionRegistryWorkspace,
} from "@/lib/omo/session-registry";
import {
  startFakeOmoHost,
  type FakeOmoFixture,
  type FakeOmoHost,
} from "@/tests/helpers/omo-fake-host";
import {
  createRegistryTestDatabase,
  insertIndexRow as insertDatabaseIndexRow,
  readIndexRow as readDatabaseIndexRow,
} from "@/tests/lib/omo/session-registry-db-fixture";

export type RegistryFixture = {
  readonly sqlite: Database.Database;
  readonly host: FakeOmoHost;
  readonly runtime: OmoRuntime;
  readonly workspace: OmoSessionRegistryWorkspace;
  readonly workspacePath: string;
  readonly addWorkspace: (
    id: string,
    path?: string,
  ) => OmoSessionRegistryWorkspace;
  readonly close: () => Promise<void>;
};

const automaticFixtures: RegistryFixture[] = [];

export function insertIndexRow(
  ...parameters: Parameters<typeof insertDatabaseIndexRow>
): void {
  insertDatabaseIndexRow(...parameters);
}

export function readIndexRow(
  ...parameters: Parameters<typeof readDatabaseIndexRow>
): ReturnType<typeof readDatabaseIndexRow> {
  return readDatabaseIndexRow(...parameters);
}

export function openFixture(options: {
  readonly durableId: string;
  readonly routingHandle?: string;
  readonly sessionPath: string;
  readonly attached?: boolean;
  readonly isStreaming?: boolean;
  readonly events?: readonly JsonlRecord[];
}): FakeOmoFixture {
  const routingHandle = options.routingHandle ?? `route-${options.durableId}`;
  return {
    type: "open_session",
    response: {
      data: {
        sessionId: routingHandle,
        state: {
          sessionId: options.durableId,
          sessionFile: options.sessionPath,
          sessionName: options.durableId,
          status: "idle",
          isStreaming: options.isStreaming ?? false,
        },
        ...(options.attached ? { attached: true } : {}),
      },
    },
    ...(options.events ? { events: options.events } : {}),
  };
}

export function entriesFixture(
  entries: readonly JsonlRecord[],
  leafId: string | null,
  events?: readonly JsonlRecord[],
): FakeOmoFixture {
  return {
    type: "get_entries",
    response: { data: { entries, leafId } },
    ...(events ? { events } : {}),
  };
}

export function navigateFixture(leafId: string | null): FakeOmoFixture {
  return {
    type: "navigate_tree",
    response: { data: { outcome: "navigated", leafId } },
  };
}

export async function createRegistryFixture(
  fixturesOrFactory:
    | readonly FakeOmoFixture[]
    | ((workspacePath: string) => readonly FakeOmoFixture[]),
): Promise<RegistryFixture> {
  vi.resetModules();
  const workspacePath = await mkdtemp(join(tmpdir(), "devhub-registry-"));
  const sqlite = createRegistryTestDatabase();
  vi.doMock("@/lib/db", () => ({ db: drizzle(sqlite, { schema }) }));
  const fixtures =
    typeof fixturesOrFactory === "function"
      ? fixturesOrFactory(workspacePath)
      : fixturesOrFactory;
  const host = await startFakeOmoHost({ fixtures });
  const registryModule = await import("@/lib/omo/session-registry");
  const runtime = registryModule.getOmoRuntime(host.socketPath);
  const workspace = { id: "workspace-1", path: workspacePath };

  return {
    sqlite,
    host,
    runtime,
    workspace,
    workspacePath,
    addWorkspace(id, path = workspacePath) {
      sqlite.prepare("INSERT INTO workspaces VALUES (?, 'user-1')").run(id);
      return { id, path };
    },
    async close() {
      registryModule.disposeOmoRuntime(host.socketPath);
      await host.close();
      sqlite.close();
      vi.doUnmock("@/lib/db");
      await rm(workspacePath, { recursive: true, force: true });
    },
  };
}

export function openedResponse(options: {
  readonly durableId: string;
  readonly routingHandle?: string;
  readonly sessionPath: string;
  readonly attached?: boolean;
  readonly state?: JsonlRecord;
}): JsonlRecord {
  const fixture = openFixture({
    durableId: options.durableId,
    sessionPath: options.sessionPath,
    ...(options.routingHandle ? { routingHandle: options.routingHandle } : {}),
    ...(options.attached ? { attached: true } : {}),
    isStreaming: options.state?.["isStreaming"] === true,
  });
  return fixture.response;
}

export function entriesResponse(
  options: {
    readonly entries?: readonly JsonlRecord[];
    readonly leafId?: string | null;
  } = {},
): JsonlRecord {
  return entriesFixture(
    options.entries ?? [],
    options.leafId === undefined ? null : options.leafId,
  ).response;
}

export async function createRegistryContext(
  fixtures: readonly FakeOmoFixture[],
): Promise<RegistryFixture> {
  const fixture = await createRegistryFixture(fixtures);
  automaticFixtures.push(fixture);
  return fixture;
}

export function receivedByType(
  fixture: RegistryFixture,
  type: string,
): readonly JsonlRecord[] {
  return recordsOfType(fixture, type);
}

export function recordsOfType(
  fixture: RegistryFixture,
  type: string,
): readonly JsonlRecord[] {
  return fixture.host.connections.flatMap((connection) =>
    connection.records.filter((record) => record["type"] === type),
  );
}

afterEach(async () => {
  for (const fixture of automaticFixtures.splice(0)) await fixture.close();
});

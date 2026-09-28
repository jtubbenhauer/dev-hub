import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { vi } from "vitest";
import type { JsonlRecord } from "@/lib/omo/jsonl";
import type { OmoRuntime } from "@/lib/omo/session-registry";
import type { SessionSource } from "@/lib/omo/session-source";
import { encodeCwdDir } from "@/lib/omo/sessions-on-disk";
import type { FakeOmoFixture } from "@/tests/helpers/omo-fake-host";

type CatalogFixtureOptions = {
  readonly durableId?: string;
  readonly routingHandle?: string;
  readonly sessionFile?: string;
  readonly omitSessionFile?: boolean;
  readonly selectedModel?: { readonly provider: string; readonly id: string };
  readonly openError?: {
    readonly code: "host_draining" | "host_memory_pressure";
    readonly retryAfterMs: number;
  };
  readonly commands?: readonly JsonlRecord[];
  readonly models?: readonly JsonlRecord[];
  readonly mcpServers?: readonly JsonlRecord[];
};

type ProbeOpenOptions = Pick<
  CatalogFixtureOptions,
  | "durableId"
  | "routingHandle"
  | "sessionFile"
  | "omitSessionFile"
  | "selectedModel"
>;

function isRecord(value: unknown): value is JsonlRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function responsePayload(record: JsonlRecord): JsonlRecord {
  let payload: JsonlRecord = {};
  const envelopeKeys = new Set([
    "type",
    "id",
    "command",
    "direction",
    "timestamp",
    "sessionId",
  ]);
  for (const [key, value] of Object.entries(record)) {
    if (!envelopeKeys.has(key)) payload = { ...payload, [key]: value };
  }
  return payload;
}

function replaceResponseData(
  fixtures: readonly FakeOmoFixture[],
  type: string,
  data: JsonlRecord,
): FakeOmoFixture[] {
  return fixtures.map((fixture) =>
    fixture.type === type
      ? { ...fixture, response: { ...fixture.response, data } }
      : fixture,
  );
}

export function withProbeOpen(
  fixtures: readonly FakeOmoFixture[],
  options: ProbeOpenOptions,
): FakeOmoFixture[] {
  return replaceResponseData(fixtures, "open_session", {
    sessionId: options.routingHandle ?? "rpc-catalog-1",
    state: {
      sessionId: options.durableId ?? "durable-catalog-1",
      cwd: "/TMP",
      isStreaming: false,
      pendingQuestions: [],
      ...(options.selectedModel ? { model: options.selectedModel } : {}),
      ...(!options.omitSessionFile
        ? { sessionFile: options.sessionFile ?? "/TMP/catalog.jsonl" }
        : {}),
    },
  });
}

export async function catalogFixtures(
  options: CatalogFixtureOptions = {},
): Promise<readonly FakeOmoFixture[]> {
  if (options.openError !== undefined) {
    return [
      {
        type: "open_session",
        response: {
          success: false,
          error: options.openError.code,
          errorCode: options.openError.code,
          errorData: { retry_after_ms: options.openError.retryAfterMs },
        },
      },
    ];
  }

  const fixtureText = await readFile(
    join(process.cwd(), "tests/fixtures/omo/catalog.jsonl"),
    "utf8",
  );
  const fixtures: FakeOmoFixture[] = [];
  for (const line of fixtureText.split("\n")) {
    if (!line.trim()) continue;
    const parsed: unknown = JSON.parse(line);
    if (
      !isRecord(parsed) ||
      parsed["direction"] !== "server_to_client" ||
      parsed["type"] !== "response" ||
      typeof parsed["command"] !== "string"
    ) {
      continue;
    }
    fixtures.push({
      type: parsed["command"],
      response: responsePayload(parsed),
    });
  }

  let configured = withProbeOpen(fixtures, options);
  if (options.models !== undefined) {
    configured = replaceResponseData(configured, "get_available_models", {
      models: options.models,
    });
  }
  if (options.commands !== undefined) {
    configured = replaceResponseData(configured, "get_commands", {
      commands: options.commands,
    });
  }
  if (options.mcpServers !== undefined) {
    configured = replaceResponseData(configured, "get_loaded_surfaces", {
      extensions: [],
      mcpServers: options.mcpServers,
    });
  }
  return configured;
}

export function createStubSessionSource(workspacePath: string) {
  const removeProbeSession = vi.fn(
    async (_rawProbeId: string, _sessionFile: string | undefined) => undefined,
  );
  const source: SessionSource = {
    list: async () => [],
    readEntries: async () => [],
    remove: async () => undefined,
    removeProbeSession,
    canonicalWorkspacePath: async () => workspacePath,
    authorizeSession: async () => true,
  };
  return { source, removeProbeSession };
}

export async function writeProbeSession(
  agentDir: string,
  workspacePath: string,
  durableId: string,
): Promise<string> {
  const sessionsDir = join(
    agentDir,
    "sessions",
    `--${encodeCwdDir(workspacePath)}--`,
  );
  await mkdir(sessionsDir, { recursive: true });
  const sessionFile = join(sessionsDir, `${durableId}.jsonl`);
  await writeFile(
    sessionFile,
    `${JSON.stringify({
      type: "session",
      version: 3,
      id: durableId,
      timestamp: "2026-09-28T10:07:00.000Z",
      cwd: workspacePath,
    })}\n`,
    "utf8",
  );
  return sessionFile;
}

export function waitForClientRecord(
  runtime: OmoRuntime,
  type: string,
): Promise<void> {
  return new Promise((resolve) => {
    const stop = runtime.client.on((record) => {
      if (record["type"] !== type) return;
      stop();
      resolve();
    });
  });
}

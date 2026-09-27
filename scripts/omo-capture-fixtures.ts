import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Duplex, Writable } from "node:stream";
import { promisify } from "node:util";

import { ensureOmoDaemon } from "@/lib/omo/daemon";
import {
  createJsonlDecoder,
  encodeJsonl,
  type JsonlRecord,
} from "@/lib/omo/jsonl";
import {
  OmoRpcClient,
  UnixSocketTransport,
  type Transport,
} from "@/lib/omo/rpc-client";

const execFileAsync = promisify(execFile);
const EVENT_TIMEOUT_MS = 60_000;
const FIXTURE_NAMES = [
  "text-turn",
  "tool-call",
  "thinking",
  "question",
  "task-subagent",
  "compaction",
  "abort",
  "catalog",
  "lifecycle",
] as const;

type FixtureName = (typeof FIXTURE_NAMES)[number];
type Direction = "client_to_server" | "server_to_client";

class CaptureSkippedError extends Error {
  readonly name = "CaptureSkippedError";
}

class FixtureRecorder {
  private activeFixture: FixtureName | undefined;
  private readonly records = new Map<FixtureName, JsonlRecord[]>();

  setActive(fixture: FixtureName | undefined): void {
    this.activeFixture = fixture;
  }

  record(direction: Direction, record: JsonlRecord): void {
    const fixture = this.activeFixture;
    if (fixture === undefined) return;
    const records = this.records.get(fixture) ?? [];
    records.push({
      ...record,
      direction,
      timestamp: new Date().toISOString(),
    });
    this.records.set(fixture, records);
  }

  get(fixture: FixtureName): readonly JsonlRecord[] {
    return this.records.get(fixture) ?? [];
  }
}

class RecordingTransport implements Transport {
  readonly kind = "unix";
  private socket: Duplex | undefined;

  constructor(
    private readonly socketPath: string,
    private readonly recorder: FixtureRecorder,
  ) {}

  async connect(): Promise<Duplex> {
    const socket = await new UnixSocketTransport({
      socketPath: this.socketPath,
    }).connect();
    this.socket = socket;
    const inbound = createJsonlDecoder((record) =>
      this.recorder.record("server_to_client", record),
    );
    const outbound = createJsonlDecoder((record) =>
      this.recorder.record("client_to_server", record),
    );
    socket.on("data", (chunk: string | Uint8Array) => inbound.write(chunk));
    socket.on("end", inbound.end);
    const writable = new Writable({
      write: (chunk: Buffer, _encoding, callback) => {
        outbound.write(chunk);
        socket.write(chunk, callback);
      },
      final: (callback) => {
        outbound.end();
        socket.end(callback);
      },
    });
    return Duplex.from({ readable: socket, writable });
  }

  sendUncorrelated(record: JsonlRecord): void {
    const socket = this.socket;
    if (socket === undefined) {
      throw new CaptureSkippedError("OmO transport is not connected");
    }
    this.recorder.record("client_to_server", record);
    socket.write(encodeJsonl(record));
  }
}

function waitForRecord(
  client: OmoRpcClient,
  sessionId: string,
  predicate: (record: JsonlRecord) => boolean,
): Promise<JsonlRecord> {
  const promise = new Promise<JsonlRecord>((resolveRecord, reject) => {
    let unsubscribe = (): void => undefined;
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new CaptureSkippedError("timed out waiting for an OmO event"));
    }, EVENT_TIMEOUT_MS);
    timer.unref();
    unsubscribe = client.onSession(sessionId, (record) => {
      if (!predicate(record)) return;
      clearTimeout(timer);
      unsubscribe();
      resolveRecord(record);
    });
  });
  void promise.catch(() => undefined);
  return promise;
}

function recordType(record: JsonlRecord): string | undefined {
  return typeof record["type"] === "string" ? record["type"] : undefined;
}

function nestedType(record: JsonlRecord): string | undefined {
  const event = record["assistantMessageEvent"];
  return typeof event === "object" && event !== null && "type" in event
    ? String(event.type)
    : undefined;
}

function failureReason(records: readonly JsonlRecord[]): string | undefined {
  for (const record of records) {
    const serialized = JSON.stringify(record);
    const isFailure =
      record["success"] === false ||
      recordType(record) === "extension_error" ||
      /"error(Message)?"\s*:/.test(serialized);
    if (
      isFailure &&
      /auth|credential|provider|api.?key|model/i.test(serialized)
    ) {
      return "model provider authentication is not configured";
    }
  }
  return undefined;
}

async function openCapturedSession(
  client: OmoRpcClient,
  recorder: FixtureRecorder,
  fixture: FixtureName,
  cwd: string,
  params: JsonlRecord = {},
): Promise<string> {
  recorder.setActive(fixture);
  const opened = await client.openSession(
    { cwd, retain_on_disconnect: false, ...params },
    () => undefined,
  );
  client.onSession(opened.sessionId, () => undefined);
  return opened.sessionId;
}

async function promptUntilSettled(
  client: OmoRpcClient,
  sessionId: string,
  message: string,
  extra: JsonlRecord = {},
): Promise<void> {
  const settled = waitForRecord(
    client,
    sessionId,
    (record) => recordType(record) === "agent_settled",
  );
  await client.request({ type: "prompt", sessionId, message, ...extra });
  await settled;
}

async function closeSession(
  client: OmoRpcClient,
  sessionId: string,
): Promise<void> {
  await client.request({ type: "close_session", sessionId });
}

async function capturePromptScenarios(
  client: OmoRpcClient,
  recorder: FixtureRecorder,
  cwd: string,
): Promise<void> {
  const scenarios = [
    ["text-turn", "Reply with exactly: pong", {}],
    ["tool-call", "Read ./hello.txt and tell me its contents", {}],
    ["thinking", "Reply with exactly: pong", { thinkingLevel: "high" }],
    [
      "task-subagent",
      "Use the task tool with subagent_type explore to list files, then summarize",
      {},
    ],
  ] as const;
  for (const [fixture, message, extra] of scenarios) {
    const sessionId = await openCapturedSession(
      client,
      recorder,
      fixture,
      cwd,
      extra,
    );
    await promptUntilSettled(client, sessionId, message);
    const reason = failureReason(recorder.get(fixture));
    if (reason !== undefined) throw new CaptureSkippedError(reason);
    await closeSession(client, sessionId);
  }
}

async function captureQuestion(
  client: OmoRpcClient,
  transport: RecordingTransport,
  recorder: FixtureRecorder,
  cwd: string,
): Promise<void> {
  const sessionId = await openCapturedSession(
    client,
    recorder,
    "question",
    cwd,
  );
  const question = waitForRecord(
    client,
    sessionId,
    (record) => recordType(record) === "extension_ui_request",
  );
  const settled = waitForRecord(
    client,
    sessionId,
    (record) => recordType(record) === "agent_settled",
  );
  await client.request({
    type: "prompt",
    sessionId,
    message:
      "Ask me one question with two options using your question tool, then stop",
  });
  const request = await question;
  transport.sendUncorrelated({
    type: "extension_ui_response",
    sessionId,
    id: request["id"],
    answers: { q1: { selected: ["Option A"] } },
  });
  await settled;
  await closeSession(client, sessionId);
}

async function captureRemainingScenarios(
  client: OmoRpcClient,
  recorder: FixtureRecorder,
  cwd: string,
): Promise<void> {
  let sessionId = await openCapturedSession(
    client,
    recorder,
    "compaction",
    cwd,
  );
  await promptUntilSettled(client, sessionId, "Remember the word fixture.");
  const compacted = waitForRecord(
    client,
    sessionId,
    (record) => recordType(record) === "compaction_end",
  );
  await client.request({ type: "compact", sessionId });
  await compacted;
  await closeSession(client, sessionId);

  sessionId = await openCapturedSession(client, recorder, "abort", cwd);
  const firstDelta = waitForRecord(
    client,
    sessionId,
    (record) => nestedType(record) === "text_delta",
  );
  await client.request({
    type: "prompt",
    sessionId,
    message: "Write a long explanation of JSONL framing.",
  });
  await firstDelta;
  await client.request({ type: "abort", sessionId });
  await closeSession(client, sessionId);

  sessionId = await openCapturedSession(client, recorder, "catalog", cwd);
  for (const type of [
    "get_available_models",
    "get_commands",
    "get_loaded_surfaces",
    "get_available_thinking_levels",
  ]) {
    await client.request({ type, sessionId });
  }
  await closeSession(client, sessionId);
}

async function captureLifecycle(
  client: OmoRpcClient,
  recorder: FixtureRecorder,
  cwd: string,
): Promise<void> {
  recorder.setActive("lifecycle");
  const sessionPath = join(cwd, "lifecycle-session.jsonl");
  const first = await client.openSession(
    { sessionPath, cwd, retain_on_disconnect: false },
    () => undefined,
  );
  await client.openSession({ sessionPath }, () => undefined);
  await client.request({ type: "list_sessions", include_workers: true });
  await closeSession(client, first.sessionId);
  recorder.setActive(undefined);
  await closeSession(client, first.sessionId);
}

function scrub(value: unknown, tempRoot: string, key = ""): unknown {
  if (typeof value === "string") {
    if (/secret|token|api.?key|authorization/i.test(key)) return "[REDACTED]";
    return value
      .replaceAll(homedir(), "/HOME")
      .replaceAll(tempRoot, "/TMP")
      .replace(/sk-[A-Za-z0-9_-]+/g, "[REDACTED]")
      .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]");
  }
  if (Array.isArray(value)) return value.map((item) => scrub(item, tempRoot));
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value).map(([entryKey, entryValue]) => [
      entryKey,
      scrub(entryValue, tempRoot, entryKey),
    ]),
  );
}

async function publishFixtures(
  recorder: FixtureRecorder,
  outDir: string,
  tempRoot: string,
): Promise<void> {
  await mkdir(outDir, { recursive: true });
  for (const fixture of FIXTURE_NAMES) {
    const lines = recorder
      .get(fixture)
      .map((record) => JSON.stringify(scrub(record, tempRoot)))
      .join("\n");
    await writeFile(join(outDir, `${fixture}.jsonl`), `${lines}\n`);
  }
  await writeFile(
    join(outDir, "README.md"),
    [
      "source: live-captured",
      "client_info_scope: connection",
      "probe_writes_file: unknown",
      "todo_tool: none",
      "task_child_keys: {parent_session_id, tasks:[{task_id, child_session_id?, agent_type?, category?, status?}]}",
      "",
    ].join("\n"),
  );
}

function outputDirectory(): string {
  const index = process.argv.indexOf("--out");
  const value = index === -1 ? undefined : process.argv[index + 1];
  return resolve(value ?? "tests/fixtures/omo");
}

function skipReason(error: unknown): string {
  const reason = error instanceof Error ? error.message : String(error);
  if (/auth|credential|provider|api.?key|\/login/i.test(reason)) {
    return "model provider authentication is not configured";
  }
  return reason.replace(/\s+/g, " ").trim();
}

async function main(): Promise<void> {
  if (process.argv.includes("--dry-run")) {
    console.log("SKIPPED: dry run requested");
    return;
  }
  let tempRoot: string | undefined;
  let client: OmoRpcClient | undefined;
  try {
    await execFileAsync("omo", ["--version"], { timeout: 10_000 });
    const daemon = await ensureOmoDaemon();
    tempRoot = await mkdtemp(join(tmpdir(), "dev-hub-omo-fixtures-"));
    await writeFile(join(tempRoot, "hello.txt"), "hello from fixture\n");
    const recorder = new FixtureRecorder();
    const transport = new RecordingTransport(daemon.socket, recorder);
    client = new OmoRpcClient({ transport });
    await client.connect();
    await capturePromptScenarios(client, recorder, tempRoot);
    await captureQuestion(client, transport, recorder, tempRoot);
    await captureRemainingScenarios(client, recorder, tempRoot);
    await captureLifecycle(client, recorder, tempRoot);
    await publishFixtures(recorder, outputDirectory(), tempRoot);
    console.log(`Captured ${FIXTURE_NAMES.length} OmO fixture files`);
  } catch (error) {
    console.log(`SKIPPED: ${skipReason(error)}`);
  } finally {
    client?.close();
    if (tempRoot !== undefined)
      await rm(tempRoot, { recursive: true, force: true });
  }
}

void main();

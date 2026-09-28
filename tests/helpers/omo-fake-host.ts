import { randomBytes } from "node:crypto";
import { rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createJsonlDecoder,
  encodeJsonl,
  type JsonlRecord,
} from "@/lib/omo/jsonl";
import { FakeOmoConnection } from "@/tests/helpers/omo-fake-connection";
import {
  DEFAULT_PROTOCOL_INFO,
  recordField,
  responseFor,
  stringField,
} from "@/tests/helpers/omo-fake-host-protocol";

export { FakeOmoConnection };

export type FakeOmoFixture = {
  readonly type: string;
  readonly sessionId?: string;
  readonly response: JsonlRecord;
  readonly events?: readonly JsonlRecord[];
};

export type StartFakeOmoHostOptions = {
  readonly fixtures: readonly FakeOmoFixture[];
  readonly protocolInfo?: JsonlRecord;
};

export type FakeOmoHost = {
  readonly socketPath: string;
  readonly connections: readonly FakeOmoConnection[];
  readonly preResponseEvents: (count: number) => void;
  readonly emit: (record: JsonlRecord) => void;
  readonly dropAll: () => void;
  readonly capabilitiesFor: (
    connection: FakeOmoConnection,
  ) => readonly string[];
  readonly waitForConnection: () => Promise<FakeOmoConnection>;
  readonly close: () => Promise<void>;
};

export async function startFakeOmoHost(
  options: StartFakeOmoHostOptions,
): Promise<FakeOmoHost> {
  const socketPath = join(
    tmpdir(),
    `devhub-omo-${randomBytes(8).toString("hex")}.sock`,
  );
  const fixtures = [...options.fixtures];
  const connections: FakeOmoConnection[] = [];
  const connectionWaiters: Array<(connection: FakeOmoConnection) => void> = [];
  const sessions = new Map<string, JsonlRecord>();
  const preResponseEventCounts: number[] = [];
  let sessionCounter = 0;

  const send = (connection: FakeOmoConnection, record: JsonlRecord): void => {
    connection.socket.write(encodeJsonl(record));
  };

  const takeFixture = (request: JsonlRecord): FakeOmoFixture | undefined => {
    const type = stringField(request, "type");
    const sessionId = stringField(request, "sessionId");
    const index = fixtures.findIndex(
      (fixture) =>
        fixture.type === type &&
        (fixture.sessionId === undefined || fixture.sessionId === sessionId),
    );
    return index === -1 ? undefined : fixtures.splice(index, 1)[0];
  };

  const handleRecord = (
    connection: FakeOmoConnection,
    request: JsonlRecord,
  ): void => {
    connection.captureRecord(request);
    const type = stringField(request, "type");
    const fixture = takeFixture(request);
    let eventSessionId = stringField(request, "sessionId");

    if (type === "set_client_info") {
      const capabilities = request["capabilities"];
      connection.setCapabilities(
        Array.isArray(capabilities)
          ? capabilities.filter(
              (value): value is string => typeof value === "string",
            )
          : [],
      );
      send(connection, responseFor(request, fixture?.response ?? {}));
    } else if (type === "get_protocol_info") {
      send(
        connection,
        responseFor(request, {
          data: {
            ...DEFAULT_PROTOCOL_INFO,
            ...options.protocolInfo,
          },
          ...fixture?.response,
        }),
      );
    } else if (type === "open_session") {
      sessionCounter += 1;
      const fixtureData = fixture
        ? recordField(fixture.response, "data")
        : undefined;
      const sessionId =
        (fixtureData ? stringField(fixtureData, "sessionId") : undefined) ??
        `fake-session-${sessionCounter}`;
      eventSessionId = sessionId;
      sessions.set(sessionId, { sessionId, status: "idle" });
      const eventCount = preResponseEventCounts.shift() ?? 0;
      for (let index = 0; index < eventCount; index += 1) {
        send(connection, { type: "fake_pre_response", index, sessionId });
      }
      send(
        connection,
        responseFor(request, {
          data: { sessionId, state: { sessionId, status: "idle" } },
          sessionId,
          ...fixture?.response,
        }),
      );
    } else if (type === "list_sessions") {
      send(
        connection,
        responseFor(request, {
          data: { sessions: [...sessions.values()] },
          ...fixture?.response,
        }),
      );
    } else if (type === "close_session") {
      const sessionId = stringField(request, "sessionId");
      if (sessionId) sessions.delete(sessionId);
      send(
        connection,
        responseFor(request, { sessionId, ...fixture?.response }),
      );
    } else if (fixture) {
      send(connection, responseFor(request, fixture.response));
    } else {
      send(
        connection,
        responseFor(request, { success: false, error: "unhandled_command" }),
      );
    }

    for (const event of fixture?.events ?? []) {
      send(connection, {
        ...(eventSessionId ? { sessionId: eventSessionId } : {}),
        ...event,
      });
    }
  };

  const server = createServer((socket) => {
    const connection = new FakeOmoConnection(socket);
    connections.push(connection);
    for (const resolve of connectionWaiters.splice(0)) resolve(connection);
    const decoder = createJsonlDecoder((record) =>
      handleRecord(connection, record),
    );
    socket.on("data", (chunk) => {
      connection.captureChunk(chunk);
      decoder.write(chunk);
    });
    socket.on("end", decoder.end);
    socket.on("error", () => undefined);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => {
      server.off("error", reject);
      resolve();
    });
  });

  return {
    socketPath,
    get connections(): readonly FakeOmoConnection[] {
      return connections;
    },
    preResponseEvents(count): void {
      preResponseEventCounts.push(count);
    },
    emit(record): void {
      for (const connection of connections) send(connection, record);
    },
    dropAll(): void {
      for (const connection of connections) connection.socket.destroy();
    },
    capabilitiesFor(connection): readonly string[] {
      return connection.capabilities();
    },
    waitForConnection(): Promise<FakeOmoConnection> {
      const connection = connections[0];
      return connection
        ? Promise.resolve(connection)
        : new Promise((resolve) => connectionWaiters.push(resolve));
    },
    async close(): Promise<void> {
      for (const connection of connections) connection.socket.destroy();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      await rm(socketPath, { force: true });
    },
  };
}

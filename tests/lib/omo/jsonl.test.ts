// @vitest-environment node

import { createConnection } from "node:net";
import { once } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import {
  createJsonlDecoder,
  encodeJsonl,
  type JsonlRecord,
} from "@/lib/omo/jsonl";
import {
  startFakeOmoHost,
  type FakeOmoHost,
} from "@/tests/helpers/omo-fake-host";

const hosts: FakeOmoHost[] = [];

afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.close()));
});

describe("JSONL framing", () => {
  it("decodes CRLF records split across byte chunks", () => {
    const records: JsonlRecord[] = [];
    const decoder = createJsonlDecoder((record) => records.push(record));

    decoder.write(Buffer.from('{"type":"one"}\r'));
    decoder.write(Buffer.from('\n{"type":"two"}\n'));

    expect(records).toEqual([{ type: "one" }, { type: "two" }]);
  });

  it("does not split on U+2028 inside a JSON string", () => {
    const records: JsonlRecord[] = [];
    const decoder = createJsonlDecoder((record) => records.push(record));

    decoder.write(Buffer.from('{"type":"event","text":"a b"}\n'));

    expect(records).toEqual([{ type: "event", text: "a b" }]);
  });

  it("emits parse failures for invalid JSON and non-object records", () => {
    const records: JsonlRecord[] = [];
    const decoder = createJsonlDecoder((record) => records.push(record));

    decoder.write(Buffer.from('not-json\nnull\n["array"]\n'));

    expect(records).toEqual([
      { type: "response", command: "parse", success: false },
      { type: "response", command: "parse", success: false },
      { type: "response", command: "parse", success: false },
    ]);
  });

  it("resynchronizes at the next LF after an oversized record", () => {
    const records: JsonlRecord[] = [];
    const decoder = createJsonlDecoder((record) => records.push(record));

    decoder.write(Buffer.from("x".repeat(16_777_217)));
    decoder.write(Buffer.from('\n{"type":"recovered"}\n'));

    expect(records).toEqual([
      { type: "response", command: "parse", success: false },
      { type: "recovered" },
    ]);
  });

  it("encodes one compact LF-terminated record", () => {
    expect(encodeJsonl({ type: "ping", value: " " })).toBe(
      '{"type":"ping","value":" "}\n',
    );
  });
});

describe("fake OMO host", () => {
  it("receives JSON from the first byte and sends pre-response events", async () => {
    const host = await startFakeOmoHost({ fixtures: [] });
    hosts.push(host);
    host.preResponseEvents(3);
    const socket = createConnection(host.socketPath);
    await once(socket, "connect");
    const records: JsonlRecord[] = [];
    const decoder = createJsonlDecoder((record) => records.push(record));
    socket.on("data", (chunk) => decoder.write(chunk));

    socket.write(encodeJsonl({ type: "open_session", id: "open-1" }));
    const connection = await host.waitForConnection();
    await connection.waitForRecordCount(1);
    await new Promise<void>((resolve) => {
      const check = (): void => {
        if (records.length === 4) resolve();
        else setImmediate(check);
      };
      check();
    });

    expect(connection.firstBytes.subarray(0, 1).toString()).toBe("{");
    expect(records.slice(0, 3)).toEqual([
      { type: "fake_pre_response", index: 0, sessionId: "fake-session-1" },
      { type: "fake_pre_response", index: 1, sessionId: "fake-session-1" },
      { type: "fake_pre_response", index: 2, sessionId: "fake-session-1" },
    ]);
    expect(records[3]).toMatchObject({
      id: "open-1",
      type: "response",
      command: "open_session",
      success: true,
      data: { sessionId: "fake-session-1" },
    });
    socket.destroy();
  });
});

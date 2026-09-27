import {
  OmoIncompatibleHostError,
  OmoOpenInFlightError,
} from "@/lib/omo/errors";
import { describe, expect, it } from "vitest";
import {
  CLIENT_CAPABILITIES,
  createClient,
  createHost,
  REQUIRED_HOST_CAPABILITIES,
} from "@/tests/lib/omo/rpc-client-fixture";

describe("OmoRpcClient handshake and correlation", () => {
  it("starts POSIX sockets with JSON and negotiates the required protocol", async () => {
    const host = await createHost();
    const client = createClient(host);

    const protocolInfo = await client.connect();
    const connection = await host.waitForConnection();

    expect(connection.firstBytes.subarray(0, 1).toString()).toBe("{");
    expect(connection.records.map((record) => record["type"])).toEqual([
      "set_client_info",
      "get_protocol_info",
    ]);
    expect(connection.records[0]?.["width"]).toBe(120);
    expect(host.capabilitiesFor(connection)).toEqual(CLIENT_CAPABILITIES);
    expect(protocolInfo).toMatchObject({
      protocolVersion: 1,
      mode: "multi",
      capabilities: REQUIRED_HOST_CAPABILITIES,
    });
    expect(client.isConnected).toBe(true);
  });

  it.each([
    {
      name: "a newer protocol version",
      protocolInfo: { protocolVersion: 2 },
    },
    {
      name: "the legacy multi_session mode name",
      protocolInfo: { mode: "multi_session" },
    },
    {
      name: "a host missing session_context",
      protocolInfo: {
        capabilities: REQUIRED_HOST_CAPABILITIES.filter(
          (capability) => capability !== "session_context",
        ),
      },
    },
  ])("rejects $name", async ({ protocolInfo }) => {
    const host = await createHost({ protocolInfo });
    const client = createClient(host);

    await expect(client.connect()).rejects.toBeInstanceOf(
      OmoIncompatibleHostError,
    );
    expect(client.isConnected).toBe(false);
  });

  it("correlates two requests by their in-flight ids", async () => {
    const host = await createHost({
      fixtures: [
        { type: "first", response: { data: { value: "first-result" } } },
        { type: "second", response: { data: { value: "second-result" } } },
      ],
    });
    const client = createClient(host);
    await client.connect();

    const firstPromise = client.request({ type: "first" });
    const secondPromise = client.request({ type: "second" });
    const [first, second] = await Promise.all([firstPromise, secondPromise]);
    const connection = await host.waitForConnection();
    const applicationRequests = connection.records.slice(2);

    expect(applicationRequests.map((record) => record["id"])).toEqual([
      "dh-3",
      "dh-4",
    ]);
    expect(first["data"]).toEqual({ value: "first-result" });
    expect(second["data"]).toEqual({ value: "second-result" });
  });

  it("allows only one open_session request in flight", async () => {
    const host = await createHost();
    const client = createClient(host);
    await client.connect();

    const firstOpen = client.openSession({}, () => undefined);
    const secondOpen = client.openSession({}, () => undefined);

    await expect(secondOpen).rejects.toBeInstanceOf(OmoOpenInFlightError);
    await firstOpen;
    const connection = await host.waitForConnection();
    expect(
      connection.records.filter(
        (record) => record["type"] === "open_session",
      ),
    ).toHaveLength(1);
  });
});

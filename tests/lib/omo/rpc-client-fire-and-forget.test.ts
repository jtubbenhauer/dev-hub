// @vitest-environment node

import { describe, expect, it } from "vitest";
import { OmoTransportGoneError } from "@/lib/omo/errors";
import { createClient, createHost } from "@/tests/lib/omo/rpc-client-fixture";

describe("OmoRpcClient.sendFireAndForget", () => {
  it("writes the record with its original id and expects no response", async () => {
    // Given a connected client
    const host = await createHost();
    const client = createClient(host);
    await client.connect();
    const connection = await host.waitForConnection();

    // When sending a dialog response fire-and-forget
    const countBefore = connection.records.length;
    client.sendFireAndForget({
      type: "extension_ui_response",
      id: "uuid-original-7",
      value: "typed answer",
    });
    await connection.waitForRecordCount(countBefore + 1);

    // Then the host receives the exact original id, not a dh-N counter id
    const response = connection.records.find(
      (record) => record["type"] === "extension_ui_response",
    );
    expect(response).toMatchObject({
      id: "uuid-original-7",
      value: "typed answer",
    });
  });

  it("throws when the transport is gone instead of silently dropping", async () => {
    // Given a client that never connected
    const host = await createHost();
    const client = createClient(host);

    // When / Then
    expect(() =>
      client.sendFireAndForget({ type: "extension_ui_response", id: "x" }),
    ).toThrow(OmoTransportGoneError);
  });
});

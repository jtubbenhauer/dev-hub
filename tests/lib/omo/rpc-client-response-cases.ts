import { OmoCommandError } from "@/lib/omo/errors";
import { encodeJsonl } from "@/lib/omo/jsonl";
import { describe, expect, it, vi } from "vitest";
import {
  createClient,
  createHost,
  pendingRequestCount,
} from "@/tests/lib/omo/rpc-client-fixture";

describe("OmoRpcClient response handling", () => {
  it("rejects unsuccessful responses with command details", async () => {
    const host = await createHost({
      fixtures: [
        {
          type: "failing_command",
          response: {
            success: false,
            error: "permission denied",
            errorCode: "permission_denied",
            errorData: { role: "admin" },
          },
        },
      ],
    });
    const client = createClient(host);
    await client.connect();

    const thrown: unknown = await client
      .request({ type: "failing_command" })
      .catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(OmoCommandError);
    if (!(thrown instanceof OmoCommandError)) return;
    expect(thrown.command).toBe("failing_command");
    expect(thrown.error).toBe("permission denied");
    expect(thrown.errorCode).toBe("permission_denied");
    expect(thrown.errorData).toEqual({ role: "admin" });
  });

  it("removes timed-out requests from the pending map", async () => {
    const host = await createHost();
    const client = createClient(host);
    await client.connect();
    const connection = await host.waitForConnection();
    connection.socket.pause();

    await expect(
      client.request({ type: "never_handled" }, { timeoutMs: 10 }),
    ).rejects.toThrow("Timed out waiting for OmO response");

    expect(pendingRequestCount(client)).toBe(0);
  });

  it("runs onResponse before a later record in the same chunk", async () => {
    const host = await createHost();
    const client = createClient(host);
    await client.connect();
    const connection = await host.waitForConnection();
    connection.socket.pause();
    const order: string[] = [];
    client.on((record) => {
      if (record["type"] === "after_response") order.push("event");
    });
    const request = client.request(
      { type: "ordered_command" },
      { onResponse: () => order.push("response") },
    );

    connection.socket.write(
      encodeJsonl({
        type: "response",
        id: "dh-3",
        command: "ordered_command",
        success: true,
        data: {},
      }) + encodeJsonl({ type: "after_response" }),
    );
    await request;

    expect(order).toEqual(["response", "event"]);
  });

  it("does not call onResponse for an unsuccessful response", async () => {
    const host = await createHost({
      fixtures: [
        {
          type: "failing_hook_command",
          response: { success: false, error: "rejected" },
        },
      ],
    });
    const client = createClient(host);
    await client.connect();
    const onResponse = vi.fn();

    await expect(
      client.request({ type: "failing_hook_command" }, { onResponse }),
    ).rejects.toBeInstanceOf(OmoCommandError);

    expect(onResponse).not.toHaveBeenCalled();
  });

  it("rejects immediately and clears pending state when onResponse throws", async () => {
    const host = await createHost({
      fixtures: [{ type: "hook_command", response: { data: {} } }],
    });
    const client = createClient(host);
    await client.connect();
    const hookError = new Error("hook failed");

    await expect(
      client.request(
        { type: "hook_command" },
        {
          onResponse: () => {
            throw hookError;
          },
        },
      ),
    ).rejects.toBe(hookError);

    expect(pendingRequestCount(client)).toBe(0);
  });
});

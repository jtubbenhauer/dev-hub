import { describe, expect, it } from "vitest";
import type { SessionEntry } from "@/lib/omo/sessions-on-disk";
import { readJson, useReadFixture } from "@/tests/lib/omo/facade/read-fixture";

function diskEntry(id: string): SessionEntry {
  return {
    type: "message",
    id,
    parentId: null,
    timestamp: 1,
    message: { role: "user", content: "disk", timestamp: 1 },
  };
}

function namedError(name: string, fields: Record<string, unknown> = {}): Error {
  return Object.assign(new Error(name), { name, ...fields });
}

function responseIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((message) => {
    if (
      typeof message === "object" &&
      message !== null &&
      "info" in message &&
      typeof message.info === "object" &&
      message.info !== null &&
      "id" in message.info &&
      typeof message.info.id === "string"
    ) {
      return [message.info.id];
    }
    return [];
  });
}

describe("handleOmoRead message fallback", () => {
  it.each(["OmoTransportGoneError", "OmoCorruptIndexRowError"])(
    "uses disk history after %s",
    async (errorName) => {
      const fixture = await useReadFixture();
      fixture.source.authorized.add("fallback");
      fixture.source.entries.set("fallback", [diskEntry("disk-leaf")]);
      fixture.registry.attach.mockRejectedValue(namedError(errorName));

      const response = await fixture.request(
        "/session/omo_fallback/message",
      );

      expect(response.status).toBe(200);
      expect(responseIds(await readJson(response))).toEqual(["omo_disk-leaf"]);
      expect(fixture.source.readEntries).toHaveBeenCalledWith("fallback");
    },
  );

  it("falls back when get_entries loses the host after attach", async () => {
    const fixture = await useReadFixture();
    fixture.source.authorized.add("drop");
    fixture.source.entries.set("drop", [diskEntry("drop-leaf")]);
    fixture.registry.request.mockRejectedValue(
      Object.assign(new Error("offline"), { statusCode: 503 }),
    );

    const response = await fixture.request("/session/omo_drop/message");

    expect(response.status).toBe(200);
    expect(responseIds(await readJson(response))).toEqual(["omo_drop-leaf"]);
    expect(fixture.registry.attach).toHaveBeenCalledOnce();
  });

  it("returns the canonical successor without reading replacement history", async () => {
    const fixture = await useReadFixture();
    fixture.source.authorized.add("old");
    fixture.registry.attach.mockRejectedValue(
      namedError("OmoSessionReplacedError", { newDurableId: "next" }),
    );

    const response = await fixture.request("/session/omo_old/message");

    expect(response.status).toBe(409);
    expect(response.headers.get("X-Omo-Session-Replaced")).toBe("omo_next");
    expect(await readJson(response)).toEqual({ error: "session_replaced" });
    expect(fixture.source.readEntries).not.toHaveBeenCalled();
  });
});

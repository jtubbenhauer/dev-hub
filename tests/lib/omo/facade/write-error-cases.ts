import { describe, expect, it } from "vitest";
import {
  createWriteBinding,
  namedWriteError,
  useWriteFixture,
  writeJson,
} from "@/tests/lib/omo/facade/write-fixture";

const BODY = { parts: [{ type: "text", text: "hello" }] } as const;

describe("handleOmoWrite retry and engine errors", () => {
  it("retries one session replacement and reports the successor", async () => {
    // Given
    const fixture = await useWriteFixture();
    fixture.source.authorized.add("old");
    fixture.source.authorized.add("new");
    fixture.registry.attach
      .mockRejectedValueOnce(
        namedWriteError("OmoSessionReplacedError", {
          newDurableId: "new",
        }),
      )
      .mockResolvedValueOnce(createWriteBinding("new"));

    // When
    const response = await fixture.request("/session/omo_old/prompt_async", {
      body: BODY,
    });

    // Then
    expect(response.status).toBe(204);
    expect(response.headers.get("X-Omo-Session-Replaced")).toBe("omo_new");
    expect(
      fixture.registry.attach.mock.calls.map((call) => call[0].durableId),
    ).toEqual(["old", "new"]);
  });

  it("stops after a double replacement chain", async () => {
    // Given
    const fixture = await useWriteFixture();
    fixture.source.authorized.add("old");
    fixture.source.authorized.add("new");
    fixture.registry.attach
      .mockRejectedValueOnce(
        namedWriteError("OmoSessionReplacedError", {
          newDurableId: "new",
        }),
      )
      .mockRejectedValueOnce(
        namedWriteError("OmoSessionReplacedError", {
          newDurableId: "newer",
        }),
      );

    // When
    const response = await fixture.request("/session/omo_old/prompt_async", {
      body: BODY,
    });

    // Then
    expect(response.status).toBe(409);
    expect(await writeJson(response)).toEqual({ error: "session_replaced" });
    expect(response.headers.get("X-Omo-Session-Replaced")).toBe("omo_newer");
    expect(fixture.registry.attach).toHaveBeenCalledTimes(2);
  });

  it("returns Retry-After when an open reaches a draining host", async () => {
    // Given
    const fixture = await useWriteFixture();
    fixture.source.authorized.add("root");
    fixture.registry.attach.mockRejectedValue(
      namedWriteError("OmoCommandError", {
        error: "draining",
        errorCode: "host_draining",
      }),
    );

    // When
    const response = await fixture.request("/session/omo_root/prompt_async", {
      body: BODY,
    });

    // Then
    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("2");
    expect(await writeJson(response)).toEqual({ error: "engine_unavailable" });
  });

  it("returns engine_unavailable for POST /session when the socket is missing", async () => {
    // Given
    const fixture = await useWriteFixture();
    fixture.registry.create.mockRejectedValue(
      Object.assign(new Error("connect ECONNREFUSED"), {
        code: "ECONNREFUSED",
      }),
    );

    // When
    const response = await fixture.request("/session", { body: {} });

    // Then
    expect(response.status).toBe(503);
    expect(await writeJson(response)).toEqual({ error: "engine_unavailable" });
  });

  it("returns engine_unavailable when the daemon transport is down", async () => {
    // Given
    const fixture = await useWriteFixture();
    fixture.source.authorized.add("root");
    fixture.registry.attach.mockRejectedValue(
      namedWriteError("OmoTransportGoneError"),
    );

    // When
    const response = await fixture.request("/session/omo_root/prompt_async", {
      body: BODY,
    });

    // Then
    expect(response.status).toBe(503);
    expect(await writeJson(response)).toEqual({ error: "engine_unavailable" });
  });
});

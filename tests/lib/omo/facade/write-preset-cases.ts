import { describe, expect, it } from "vitest";
import {
  namedWriteError,
  useWriteFixture,
  writeJson,
  type WriteFixture,
} from "@/tests/lib/omo/facade/write-fixture";

function setPreset(fixture: WriteFixture, preset: unknown) {
  return fixture.request("/session/omo_root/permission_preset", {
    body: { preset },
  });
}

describe("handleOmoWrite permission presets", () => {
  it.each([
    { preset: "ask", capabilities: [] },
    {
      preset: "accept-edits",
      capabilities: ["permission_preset_accept_edits"],
    },
  ])(
    "moves the live session to $preset through a short-lived second connection",
    async ({ preset, capabilities }) => {
      // Given
      const fixture = await useWriteFixture();
      fixture.source.authorized.add("root");
      fixture.client.connect.mockResolvedValue({
        protocolVersion: 1,
        capabilities,
      });

      // When
      const response = await setPreset(fixture, preset);

      // Then
      expect(response.status).toBe(204);
      expect(fixture.sideClient.openSession).toHaveBeenCalledWith(
        {
          sessionPath: "/sessions/root.jsonl",
          cwd: "/workspace",
          permissionPreset: preset,
          retain_on_disconnect: true,
          kind: "interactive",
        },
        expect.any(Function),
      );
      expect(fixture.sideClient.request).toHaveBeenCalledWith({
        type: "close_session",
        sessionId: "side-route-root",
      });
      expect(fixture.sideClient.close).toHaveBeenCalledOnce();
      expect(fixture.client.request).not.toHaveBeenCalled();
      expect(fixture.registry.detachBinding).not.toHaveBeenCalled();
    },
  );

  it("skips the second connection when the session already uses the preset", async () => {
    // Given
    const fixture = await useWriteFixture();
    fixture.source.authorized.add("root");
    await setPreset(fixture, "ask");

    // When
    const response = await setPreset(fixture, "ask");

    // Then
    expect(response.status).toBe(204);
    expect(fixture.runtime.createSideClient).toHaveBeenCalledOnce();
  });

  it("refuses a preset the running omo does not support", async () => {
    // Given
    const fixture = await useWriteFixture();
    fixture.source.authorized.add("root");

    // When
    const response = await setPreset(fixture, "auto");

    // Then
    expect(response.status).toBe(422);
    expect(await writeJson(response)).toEqual({
      error:
        "This omo version doesn't support the Auto permission mode. Update omo to use it.",
      errorCode: "permission_preset_unsupported",
    });
    expect(fixture.runtime.createSideClient).not.toHaveBeenCalled();
  });

  it.each([{ body: { preset: "yolo" } }, { body: {} }])(
    "rejects $body without touching the session",
    async ({ body }) => {
      // Given
      const fixture = await useWriteFixture();
      fixture.source.authorized.add("root");

      // When
      const response = await fixture.request(
        "/session/omo_root/permission_preset",
        { body },
      );

      // Then
      expect(response.status).toBe(400);
      expect(fixture.registry.attach).not.toHaveBeenCalled();
      expect(fixture.runtime.createSideClient).not.toHaveBeenCalled();
    },
  );

  it("forgets a session that omo no longer has open", async () => {
    // Given
    const fixture = await useWriteFixture();
    fixture.source.authorized.add("root");
    fixture.sideClient.openSession.mockResolvedValue({
      sessionId: "side-fresh",
    });

    // When
    const response = await setPreset(fixture, "ask");

    // Then
    expect(response.status).toBe(503);
    expect(fixture.sideClient.request).toHaveBeenCalledWith({
      type: "close_session",
      sessionId: "side-fresh",
    });
    expect(fixture.registry.detachBinding).toHaveBeenCalledWith(
      fixture.binding,
    );
    expect(fixture.sideClient.close).toHaveBeenCalledOnce();
  });

  it("closes the second connection when the attach fails", async () => {
    // Given
    const fixture = await useWriteFixture();
    fixture.source.authorized.add("root");
    fixture.sideClient.openSession.mockRejectedValue(
      namedWriteError("OmoTransportGoneError"),
    );

    // When
    const response = await setPreset(fixture, "ask");

    // Then
    expect(response.status).toBe(503);
    expect(fixture.sideClient.close).toHaveBeenCalledOnce();
    expect(fixture.sideClient.request).not.toHaveBeenCalled();
  });

  it("refuses to attach without a session file, which would open a new session", async () => {
    // Given
    const fixture = await useWriteFixture();
    fixture.source.authorized.add("root");
    Object.assign(fixture.binding, { sessionPath: null });

    // When
    const response = await setPreset(fixture, "ask");

    // Then
    expect(response.status).toBe(503);
    expect(fixture.runtime.createSideClient).not.toHaveBeenCalled();
  });

  it("applies a prompt's preset before sending the prompt", async () => {
    // Given
    const fixture = await useWriteFixture();
    fixture.source.authorized.add("root");

    // When
    const response = await fixture.request("/session/omo_root/prompt_async", {
      body: {
        parts: [{ type: "text", text: "Explain this" }],
        permissionPreset: "read-only",
      },
    });

    // Then
    expect(response.status).toBe(204);
    expect(fixture.sideClient.openSession).toHaveBeenCalledWith(
      expect.objectContaining({ permissionPreset: "read-only" }),
      expect.any(Function),
    );
    const presetOrder = fixture.sideClient.openSession.mock
      .invocationCallOrder[0] as number;
    const firstSessionCommandOrder = fixture.registry.request.mock
      .invocationCallOrder[0] as number;
    expect(presetOrder).toBeLessThan(firstSessionCommandOrder);
    expect(fixture.registry.request.mock.calls.at(-1)?.[1]["type"]).toBe(
      "prompt",
    );
  });

  it("applies a command's preset before running the command", async () => {
    // Given
    const fixture = await useWriteFixture();
    fixture.source.authorized.add("root");

    // When
    await fixture.request("/session/omo_root/command", {
      body: { command: "review", arguments: "src", permissionPreset: "ask" },
    });

    // Then
    const presetOrder = fixture.sideClient.openSession.mock
      .invocationCallOrder[0] as number;
    const commandOrder = fixture.registry.request.mock
      .invocationCallOrder[0] as number;
    expect(presetOrder).toBeLessThan(commandOrder);
    expect(fixture.registry.request.mock.calls.at(-1)?.[1]).toEqual({
      type: "prompt",
      message: "/review src",
    });
  });

  it.each([
    {
      path: "/session/omo_root/prompt_async",
      body: { parts: [{ type: "text", text: "Hi" }], permissionPreset: "yolo" },
    },
    {
      path: "/session/omo_root/command",
      body: { command: "review", arguments: "", permissionPreset: "yolo" },
    },
  ])(
    "rejects an unknown preset on $path without sending anything",
    async ({ path, body }) => {
      // Given
      const fixture = await useWriteFixture();
      fixture.source.authorized.add("root");

      // When
      const response = await fixture.request(path, { body });

      // Then
      expect(response.status).toBe(400);
      expect(fixture.registry.request).not.toHaveBeenCalled();
      expect(fixture.runtime.createSideClient).not.toHaveBeenCalled();
    },
  );
});

import { describe, expect, it } from "vitest";
import type { JsonlRecord } from "@/lib/omo/jsonl";
import {
  useWriteFixture,
  writeJson,
} from "@/tests/lib/omo/facade/write-fixture";

function promptBody(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    parts: [{ type: "text", text: "Explain this" }],
    ...overrides,
  };
}

function sentCommands(
  fixture: Awaited<ReturnType<typeof useWriteFixture>>,
): JsonlRecord[] {
  return fixture.registry.request.mock.calls.map((call) => call[1]);
}

describe("handleOmoWrite prompt_async", () => {
  it("sets a turn thinking level before prompting", async () => {
    // Given
    const fixture = await useWriteFixture();
    fixture.source.authorized.add("root");

    // When
    const response = await fixture.request("/session/omo_root/prompt_async", {
      body: promptBody({ variant: "high" }),
    });

    // Then
    expect(response.status).toBe(204);
    expect(sentCommands(fixture).map((command) => command["type"])).toEqual([
      "get_state",
      "set_thinking_level",
      "prompt",
    ]);
    expect(sentCommands(fixture)[1]).toMatchObject({
      type: "set_thinking_level",
      level: "high",
      scope: "turn",
    });
  });

  it("prefixes a selected skill token", async () => {
    // Given
    const fixture = await useWriteFixture();
    fixture.source.authorized.add("root");

    // When
    await fixture.request("/session/omo_root/prompt_async", {
      body: promptBody({ agent: "skill:ulw-plan" }),
    });

    // Then
    expect(sentCommands(fixture).at(-1)).toMatchObject({
      type: "prompt",
      message: "$ulw-plan Explain this",
    });
  });

  it("steers a busy session", async () => {
    // Given
    const fixture = await useWriteFixture();
    fixture.source.authorized.add("root");
    fixture.registry.request.mockImplementation(
      async (_binding, command): Promise<JsonlRecord> =>
        command["type"] === "get_state"
          ? { data: { model: null, isStreaming: true } }
          : { data: {} },
    );

    // When
    await fixture.request("/session/omo_root/prompt_async", {
      body: promptBody(),
    });

    // Then
    expect(sentCommands(fixture).at(-1)).toMatchObject({
      type: "prompt",
      streamingBehavior: "steer",
    });
  });

  it("switches models only when the requested model differs", async () => {
    // Given
    const fixture = await useWriteFixture();
    fixture.source.authorized.add("root");

    // When
    await fixture.request("/session/omo_root/prompt_async", {
      body: promptBody({
        model: { providerID: "new-provider", modelID: "new-model" },
      }),
    });

    // Then
    expect(sentCommands(fixture)[1]).toEqual({
      type: "set_model",
      provider: "new-provider",
      modelId: "new-model",
    });
  });

  it("maps image data URLs to inline RPC images", async () => {
    // Given
    const fixture = await useWriteFixture();
    fixture.source.authorized.add("root");

    // When
    await fixture.request("/session/omo_root/prompt_async", {
      body: promptBody({
        parts: [
          { type: "text", text: "Look" },
          {
            type: "file",
            mime: "image/png",
            url: "data:image/png;base64,aW1hZ2U=",
          },
        ],
      }),
    });

    // Then
    expect(sentCommands(fixture).at(-1)).toMatchObject({
      images: [{ type: "image", data: "aW1hZ2U=", mimeType: "image/png" }],
    });
  });

  it("rejects non-image file attachments before attaching", async () => {
    // Given
    const fixture = await useWriteFixture();

    // When
    const response = await fixture.request("/session/omo_root/prompt_async", {
      body: promptBody({
        parts: [
          {
            type: "file",
            mime: "application/pdf",
            url: "data:application/pdf;base64,cGRm",
          },
        ],
      }),
    });

    // Then
    expect(response.status).toBe(422);
    expect(await writeJson(response)).toEqual({
      error: "unsupported_attachment",
    });
    expect(fixture.registry.attach).not.toHaveBeenCalled();
  });
});

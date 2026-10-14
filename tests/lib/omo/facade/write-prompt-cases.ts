import { afterEach, describe, expect, it, vi } from "vitest";
import type { JsonlRecord } from "@/lib/omo/jsonl";
import {
  namedWriteError,
  useWriteFixture,
  writeJson,
  type WriteFixture,
} from "@/tests/lib/omo/facade/write-fixture";

function promptBody(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    parts: [{ type: "text", text: "Explain this" }],
    ...overrides,
  };
}

function sentCommands(fixture: WriteFixture): JsonlRecord[] {
  return fixture.registry.request.mock.calls.map((call) => call[1]);
}

function answerPromptWith(
  fixture: WriteFixture,
  answerPrompt: () => Promise<JsonlRecord>,
): void {
  fixture.registry.request.mockImplementation(
    async (_binding, command): Promise<JsonlRecord> =>
      command["type"] === "prompt"
        ? answerPrompt()
        : { data: { model: null, isStreaming: false } },
  );
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

describe("handleOmoWrite prompt refusals", () => {
  it.each([
    {
      command: "reviw",
      suggestions: ["review", "rewind"],
      reason: "unknown",
      message:
        "Unknown command /reviw. Did you mean /review, /rewind? The message wasn't sent.",
    },
    {
      command: "tmp",
      suggestions: [],
      reason: "unknown",
      message: "Unknown command /tmp. The message wasn't sent.",
    },
    {
      command: "model",
      suggestions: [],
      reason: "interactive_only",
      message:
        "/model only works in the omo terminal. The message wasn't sent.",
    },
  ])(
    "explains an unknown_command refusal for /$command",
    async ({ command, suggestions, reason, message }) => {
      // Given
      const fixture = await useWriteFixture();
      fixture.source.authorized.add("root");
      answerPromptWith(fixture, async () => {
        throw namedWriteError("OmoCommandError", {
          error: `Unknown command /${command}. Resend with "unknownCommandAsText": true to send it as text.`,
          errorCode: "unknown_command",
          errorData: { command, suggestions, reason },
        });
      });

      // When
      const response = await fixture.request("/session/omo_root/prompt_async", {
        body: promptBody({ parts: [{ type: "text", text: `/${command}` }] }),
      });

      // Then
      expect(response.status).toBe(422);
      expect(await writeJson(response)).toEqual({
        error: message,
        errorCode: "unknown_command",
      });
    },
  );
});

describe("handleOmoWrite slow prompt acceptance", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("answers 202 when omo has not accepted the prompt within ten seconds", async () => {
    // Given
    const fixture = await useWriteFixture();
    fixture.source.authorized.add("root");
    answerPromptWith(fixture, () => new Promise<JsonlRecord>(() => undefined));
    vi.useFakeTimers();

    // When
    const pending = fixture.request("/session/omo_root/prompt_async", {
      body: promptBody(),
    });
    await vi.advanceTimersByTimeAsync(10_000);
    const response = await pending;

    // Then
    expect(response.status).toBe(202);
    expect(fixture.registry.emitEvent).not.toHaveBeenCalled();
  });

  it.each([
    {
      outcome: "refusal",
      error: namedWriteError("OmoCommandError", {
        error: "Compaction failed: the context is still too large",
        errorCode: "compaction_failed",
      }),
      message: "Compaction failed: the context is still too large",
    },
    {
      outcome: "missing confirmation",
      error: new Error("Timed out waiting for OmO response"),
      message:
        "omo didn't confirm the request in time. It may still go through, so check the session before you try again.",
    },
  ])(
    "reports a $outcome after the window as a session error",
    async ({ error, message }) => {
      // Given
      const fixture = await useWriteFixture();
      fixture.source.authorized.add("root");
      let failPrompt: (reason: Error) => void = () => undefined;
      answerPromptWith(
        fixture,
        () =>
          new Promise<JsonlRecord>((_resolve, reject) => {
            failPrompt = reject;
          }),
      );
      vi.useFakeTimers();
      const pending = fixture.request("/session/omo_root/prompt_async", {
        body: promptBody(),
      });
      await vi.advanceTimersByTimeAsync(10_000);
      const response = await pending;
      vi.useRealTimers();

      // When
      failPrompt(error);

      // Then
      expect(response.status).toBe(202);
      await vi.waitFor(() => {
        expect(fixture.registry.emitEvent).toHaveBeenCalledWith("workspace-1", {
          type: "session.error",
          properties: {
            sessionID: "omo_root",
            error: { name: "UnknownError", data: { message } },
          },
        });
      });
    },
  );
});

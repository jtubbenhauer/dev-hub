import { createOmoWorkspaceEventStream } from "@/lib/omo/event-stream";
import type { RegistryFixture } from "@/tests/lib/omo/session-registry-fixture";

export type OmoSsePayload = {
  readonly workspaceId: string;
  readonly event: { readonly type: string };
};

export const ASSISTANT_MESSAGE_START = {
  type: "message_start",
  message: {
    role: "assistant",
    content: [],
    provider: "openai",
    model: "gpt-5.6-sol",
    timestamp: 1_790_589_600_045,
  },
} as const;

export const ASSISTANT_TEXT_START = {
  type: "message_update",
  assistantMessageEvent: { type: "text_start", contentIndex: 0 },
} as const;

export async function attachFixtureSession(
  fixture: RegistryFixture,
  durableId: string,
): Promise<void> {
  await fixture.runtime.registry.attach({
    workspace: fixture.workspace,
    durableId,
  });
}

export async function readSseFrame(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<string> {
  const result = await reader.read();
  if (result.done || result.value === undefined) {
    throw new TypeError("Expected an SSE frame before the stream closed");
  }
  return new TextDecoder().decode(result.value);
}

export const readSseChunk = readSseFrame;

export function parseSseFrame(frame: string): OmoSsePayload {
  if (!frame.startsWith("data: ") || !frame.endsWith("\n\n")) {
    throw new TypeError("Expected a data SSE frame");
  }
  const parsed: unknown = JSON.parse(frame.slice(6, -2));
  if (typeof parsed !== "object" || parsed === null) {
    throw new TypeError("Expected a workspace SSE payload");
  }
  const workspaceId = "workspaceId" in parsed ? parsed.workspaceId : undefined;
  const event = "event" in parsed ? parsed.event : undefined;
  if (
    typeof workspaceId !== "string" ||
    typeof event !== "object" ||
    event === null ||
    !("type" in event) ||
    typeof event.type !== "string"
  ) {
    throw new TypeError("Expected a workspace SSE payload");
  }
  return { workspaceId, event: { ...event, type: event.type } };
}

export async function readSseEnvelope(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<OmoSsePayload> {
  return parseSseFrame(await readSseFrame(reader));
}

export async function openWorkspaceEventStream(
  fixture: RegistryFixture,
  signal = new AbortController().signal,
) {
  await fixture.runtime.client.connect();
  return createOmoWorkspaceEventStream({
    workspace: fixture.workspace,
    runtime: fixture.runtime,
    signal,
  });
}

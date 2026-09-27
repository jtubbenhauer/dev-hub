// @vitest-environment node

import type { Part, Session, ToolState } from "@opencode-ai/sdk";
import { describe, expect, it } from "vitest";
import { isMessageWithParts } from "@/lib/opencode/message-validation";
import {
  buildOmoAssistantMessage,
  buildOmoFilePart,
  buildOmoReasoningPart,
  buildOmoSession,
  buildOmoTextPart,
  buildOmoToolPart,
  buildOmoUserMessage,
} from "@/lib/omo/adapter/shapes";

const SESSION_ID = "omo_session-1";
const MESSAGE_ID = "omo_message-1";

function buildValidUserInfo() {
  return buildOmoUserMessage({
    id: MESSAGE_ID,
    sessionID: SESSION_ID,
    created: 1_790_589_600_000,
    agent: "omo",
    model: { providerID: "openai", modelID: "gpt-5.6-sol" },
  });
}

function isValidWrappedPart(part: Part): boolean {
  return isMessageWithParts({ info: buildValidUserInfo(), parts: [part] });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSdkSession(value: unknown): value is Session {
  if (!isRecord(value)) return false;
  const time = value.time;
  return (
    typeof value.id === "string" &&
    typeof value.projectID === "string" &&
    typeof value.directory === "string" &&
    typeof value.title === "string" &&
    typeof value.version === "string" &&
    (value.parentID === undefined || typeof value.parentID === "string") &&
    isRecord(time) &&
    typeof time.created === "number" &&
    typeof time.updated === "number"
  );
}

describe("OMO SDK shape constructors", () => {
  it("builds a valid user message and records a skill agent", () => {
    const message = buildOmoUserMessage({
      id: MESSAGE_ID,
      sessionID: SESSION_ID,
      created: 1_790_589_600_000,
      agent: "skill:frontend",
      model: { providerID: "openai", modelID: "gpt-5.6-sol" },
    });

    expect(message).toEqual({
      id: MESSAGE_ID,
      sessionID: SESSION_ID,
      role: "user",
      time: { created: 1_790_589_600_000 },
      agent: "skill:frontend",
      model: { providerID: "openai", modelID: "gpt-5.6-sol" },
      metadata: { omoSkill: "frontend" },
    });
    expect(isMessageWithParts({ info: message, parts: [] })).toBe(true);
  });

  it("builds a valid assistant message with canonical defaults", () => {
    const message = buildOmoAssistantMessage({
      id: MESSAGE_ID,
      sessionID: SESSION_ID,
      parentMessageID: "omo_user-1",
      created: 1_790_589_600_000,
      completed: 1_790_589_600_100,
      modelID: "gpt-5.6-sol",
      providerID: "openai",
      cwd: "/workspace",
      usage: {
        input: 12,
        output: 3,
        cost: 0.25,
        cacheRead: 4,
        cacheWrite: 5,
      },
      error: { name: "UnknownError", data: { message: "failed" } },
    });

    expect(message).toEqual({
      id: MESSAGE_ID,
      sessionID: SESSION_ID,
      role: "assistant",
      time: {
        created: 1_790_589_600_000,
        completed: 1_790_589_600_100,
      },
      error: { name: "UnknownError", data: { message: "failed" } },
      parentID: "omo_user-1",
      modelID: "gpt-5.6-sol",
      providerID: "openai",
      mode: "omo",
      path: { cwd: "/workspace", root: "/workspace" },
      cost: 0.25,
      tokens: {
        input: 12,
        output: 3,
        reasoning: 0,
        cache: { read: 4, write: 5 },
      },
    });
    expect(isMessageWithParts({ info: message, parts: [] })).toBe(true);
  });

  it("builds a valid text part", () => {
    const part = buildOmoTextPart({
      id: "omo_message-1_0",
      sessionID: SESSION_ID,
      messageID: MESSAGE_ID,
      text: "hello",
    });

    expect(part).toEqual({
      id: "omo_message-1_0",
      sessionID: SESSION_ID,
      messageID: MESSAGE_ID,
      type: "text",
      text: "hello",
    });
    expect(isValidWrappedPart(part)).toBe(true);
  });

  it("builds a valid reasoning part", () => {
    const part = buildOmoReasoningPart({
      id: "omo_message-1_0",
      sessionID: SESSION_ID,
      messageID: MESSAGE_ID,
      text: "thinking",
      start: 10,
      end: 20,
    });

    expect(part).toEqual({
      id: "omo_message-1_0",
      sessionID: SESSION_ID,
      messageID: MESSAGE_ID,
      type: "reasoning",
      text: "thinking",
      time: { start: 10, end: 20 },
    });
    expect(isValidWrappedPart(part)).toBe(true);
  });

  it("builds a valid file part", () => {
    const part = buildOmoFilePart({
      id: "omo_message-1_0",
      sessionID: SESSION_ID,
      messageID: MESSAGE_ID,
      mime: "image/png",
      url: "data:image/png;base64,aGVsbG8=",
      filename: "image.png",
    });

    expect(part).toEqual({
      id: "omo_message-1_0",
      sessionID: SESSION_ID,
      messageID: MESSAGE_ID,
      type: "file",
      mime: "image/png",
      url: "data:image/png;base64,aGVsbG8=",
      filename: "image.png",
    });
    expect(isValidWrappedPart(part)).toBe(true);
  });

  const toolStates: ToolState[] = [
    { status: "pending", input: { path: "/tmp/a" }, raw: '{"path":"/tmp/a"}' },
    {
      status: "running",
      input: { path: "/tmp/a" },
      time: { start: 10 },
    },
    {
      status: "completed",
      input: { path: "/tmp/a" },
      output: "done",
      title: "read",
      metadata: { source: "fixture" },
      time: { start: 10, end: 20 },
    },
    {
      status: "error",
      input: { path: "/tmp/a" },
      error: "failed",
      time: { start: 10, end: 20 },
    },
  ];

  it.each(toolStates)("builds a valid $status tool part", (state) => {
    const part = buildOmoToolPart({
      id: "omo_call-1",
      sessionID: SESSION_ID,
      messageID: MESSAGE_ID,
      callID: "call-1",
      tool: "read",
      state,
    });

    expect(part).toEqual({
      id: "omo_call-1",
      sessionID: SESSION_ID,
      messageID: MESSAGE_ID,
      type: "tool",
      callID: "call-1",
      tool: "read",
      state,
    });
    expect(isValidWrappedPart(part)).toBe(true);
  });

  it("builds a valid SDK session with prefixed ids", () => {
    const session = buildOmoSession({
      rawId: "session-1",
      workspaceId: "workspace-1",
      directory: "/workspace",
      title: "Session title",
      created: 10,
      updated: 20,
      parentRawId: "parent-1",
    });

    expect(session).toEqual({
      id: "omo_session-1",
      projectID: "workspace-1",
      directory: "/workspace",
      parentID: "omo_parent-1",
      title: "Session title",
      version: "omo",
      time: { created: 10, updated: 20 },
    });
    expect(isSdkSession(session)).toBe(true);
  });
});

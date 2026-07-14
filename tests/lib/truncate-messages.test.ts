import { describe, it, expect } from "vitest";
import {
  truncateMessagesForTransport,
  getPartTruncation,
  MAX_PART_TEXT_CHARS,
  TRUNCATION_MARKER_KEY,
} from "@/lib/opencode/truncate-messages";
import type { Message, MessageWithParts, Part } from "@/lib/opencode/types";

function message(parts: Part[]): MessageWithParts {
  return {
    info: {
      id: "msg-1",
      sessionID: "ses-1",
      role: "assistant",
      time: { created: 1 },
    } as unknown as Message,
    parts,
  };
}

function completedTool(
  output: string,
  input: Record<string, unknown> = {},
): Part {
  return {
    id: "prt-tool",
    sessionID: "ses-1",
    messageID: "msg-1",
    type: "tool",
    callID: "call-1",
    tool: "read",
    state: {
      status: "completed",
      input,
      output,
      title: "read file",
      metadata: {},
      time: { start: 1, end: 2 },
    },
  } as Part;
}

function errorTool(error: string): Part {
  return {
    id: "prt-err",
    sessionID: "ses-1",
    messageID: "msg-1",
    type: "tool",
    callID: "call-2",
    tool: "bash",
    state: {
      status: "error",
      input: { command: "ls" },
      error,
      time: { start: 1, end: 2 },
    },
  } as Part;
}

function textPart(text: string): Part {
  return {
    id: "prt-text",
    sessionID: "ses-1",
    messageID: "msg-1",
    type: "text",
    text,
  } as Part;
}

describe("truncateMessagesForTransport", () => {
  it("clips oversized completed tool output and records the original length", () => {
    const big = "x".repeat(10_000);
    const [result] = truncateMessagesForTransport([
      message([completedTool(big)]),
    ]);
    const part = result.parts[0];

    if (part.type !== "tool" || part.state.status !== "completed") {
      throw new Error("expected completed tool part");
    }
    expect(part.state.output).toHaveLength(MAX_PART_TEXT_CHARS);
    expect(getPartTruncation(part)).toEqual({ output: 10_000 });
  });

  it("leaves small output untouched and returns the message by identity", () => {
    const input = message([completedTool("short output")]);
    const [result] = truncateMessagesForTransport([input]);

    expect(result).toBe(input);
    expect(getPartTruncation(result.parts[0])).toBeNull();
  });

  it("clips oversized error text", () => {
    const big = "e".repeat(5_000);
    const [result] = truncateMessagesForTransport([message([errorTool(big)])]);
    const part = result.parts[0];

    if (part.type !== "tool" || part.state.status !== "error") {
      throw new Error("expected error tool part");
    }
    expect(part.state.error).toHaveLength(MAX_PART_TEXT_CHARS);
    expect(getPartTruncation(part)).toEqual({ error: 5_000 });
  });

  it("clips oversized string values inside tool input (e.g. write content)", () => {
    const bigContent = "c".repeat(9_000);
    const [result] = truncateMessagesForTransport([
      message([completedTool("ok", { filePath: "a.ts", content: bigContent })]),
    ]);
    const part = result.parts[0];

    if (part.type !== "tool" || part.state.status !== "completed") {
      throw new Error("expected completed tool part");
    }
    expect(part.state.input.content).toHaveLength(MAX_PART_TEXT_CHARS);
    expect(part.state.input.filePath).toBe("a.ts");
    expect(getPartTruncation(part)).toEqual({ input: ["content"] });
  });

  it("never truncates text/reasoning parts", () => {
    const big = "t".repeat(50_000);
    const input = message([textPart(big)]);
    const [result] = truncateMessagesForTransport([input]);

    expect(result).toBe(input);
    const part = result.parts[0];
    if (part.type !== "text") throw new Error("expected text part");
    expect(part.text).toHaveLength(50_000);
  });

  it("honours a custom max length", () => {
    const [result] = truncateMessagesForTransport(
      [message([completedTool("abcdefghij")])],
      4,
    );
    const part = result.parts[0];
    if (part.type !== "tool" || part.state.status !== "completed") {
      throw new Error("expected completed tool part");
    }
    expect(part.state.output).toBe("abcd");
  });

  it("preserves part identity fields when clipping", () => {
    const [result] = truncateMessagesForTransport([
      message([completedTool("y".repeat(3_000))]),
    ]);
    const part = result.parts[0];
    if (part.type !== "tool") throw new Error("expected tool part");
    expect(part.id).toBe("prt-tool");
    expect(part.callID).toBe("call-1");
    expect(part.tool).toBe("read");
    if (part.state.status !== "completed")
      throw new Error("expected completed");
    expect(part.state.title).toBe("read file");
    expect(part.metadata?.[TRUNCATION_MARKER_KEY]).toBeDefined();
  });

  it("getPartTruncation returns null for non-tool parts", () => {
    expect(getPartTruncation(textPart("hello"))).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { extractFilePathFromToolPart } from "@/lib/chat/extract-tool-file-path";
import type { Part, ToolPart } from "@/lib/opencode/types";

type ToolState = ToolPart["state"];

function toolPart(tool: string, state: ToolState): Part {
  return {
    id: "part-1",
    sessionID: "session-1",
    messageID: "message-1",
    type: "tool",
    callID: "call-1",
    tool,
    state,
  };
}

function completed(input: Record<string, unknown>): ToolState {
  return {
    status: "completed",
    input,
    output: "",
    title: "",
    metadata: {},
    time: { start: 1, end: 2 },
  };
}

describe("extractFilePathFromToolPart", () => {
  it.each([
    {
      tool: "write",
      input: { filePath: "src/foo.ts" },
      expected: "src/foo.ts",
    },
    { tool: "edit", input: { path: "src/bar.ts" }, expected: "src/bar.ts" },
    {
      tool: "write",
      input: { file_path: "src/baz.ts" },
      expected: "src/baz.ts",
    },
    { tool: "write", input: { file: "src/qux.ts" }, expected: "src/qux.ts" },
  ])("returns $expected for a completed $tool", ({ tool, input, expected }) => {
    expect(extractFilePathFromToolPart(toolPart(tool, completed(input)))).toBe(
      expected,
    );
  });

  it("returns null for a tool that does not modify files", () => {
    const part = toolPart("read", completed({ filePath: "src/foo.ts" }));

    expect(extractFilePathFromToolPart(part)).toBeNull();
  });

  it("returns null for a write that is still running", () => {
    const part = toolPart("write", {
      status: "running",
      input: { filePath: "src/foo.ts" },
      time: { start: 1 },
    });

    expect(extractFilePathFromToolPart(part)).toBeNull();
  });

  it("returns null for a write that failed", () => {
    const part = toolPart("write", {
      status: "error",
      input: { filePath: "src/foo.ts" },
      error: "denied",
      time: { start: 1, end: 2 },
    });

    expect(extractFilePathFromToolPart(part)).toBeNull();
  });

  it("returns null for a part that is not a tool call", () => {
    const part: Part = {
      id: "part-1",
      sessionID: "session-1",
      messageID: "message-1",
      type: "text",
      text: "hello",
    };

    expect(extractFilePathFromToolPart(part)).toBeNull();
  });
});

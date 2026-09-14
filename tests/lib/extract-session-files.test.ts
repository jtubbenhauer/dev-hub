import { describe, it, expect } from "vitest";
import {
  extractSessionFiles,
  extractSessionFilesMulti,
} from "@/lib/chat/extract-session-files";
import type { MessageWithParts } from "@/lib/opencode/types";

function makeToolPart(
  tool: string,
  input: Record<string, unknown>,
  status: "completed" | "running" = "completed",
) {
  return {
    id: `part-${Math.random()}`,
    sessionID: "s1",
    messageID: "m1",
    type: "tool" as const,
    callID: "c1",
    tool,
    state:
      status === "completed"
        ? {
            status: "completed" as const,
            input,
            output: "",
            title: "",
            metadata: {},
            time: { start: 0, end: 1 },
          }
        : {
            status: "running" as const,
            input,
            time: { start: 0 },
          },
  };
}

function makeMessage(
  parts: ReturnType<typeof makeToolPart>[],
): MessageWithParts {
  return {
    info: {
      id: "m1",
      sessionID: "s1",
      role: "assistant",
      time: { created: Date.now() },
      parentID: "",
      modelID: "",
      providerID: "",
      mode: "",
      path: { cwd: "", root: "" },
      cost: 0,
      tokens: {
        input: 0,
        output: 0,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      },
    },
    parts,
  };
}

describe("extractSessionFiles", () => {
  it("returns empty array for empty messages", () => {
    expect(extractSessionFiles([])).toEqual([]);
  });

  it("returns empty array for messages with no tool parts", () => {
    const messages: MessageWithParts[] = [
      {
        info: {
          id: "m1",
          sessionID: "s1",
          role: "user",
          time: { created: Date.now() },
          agent: "",
          model: { providerID: "", modelID: "" },
        },
        parts: [
          {
            id: "p1",
            sessionID: "s1",
            messageID: "m1",
            type: "text" as const,
            text: "hello",
          },
        ],
      },
    ];
    expect(extractSessionFiles(messages)).toEqual([]);
  });

  it("classifies write on first touch as created", () => {
    const messages = [
      makeMessage([makeToolPart("write", { filePath: "src/foo.ts" })]),
    ];
    const result = extractSessionFiles(messages);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      path: "src/foo.ts",
      name: "foo.ts",
      action: "created",
      count: 1,
    });
  });

  it("classifies edit as modified", () => {
    const messages = [
      makeMessage([makeToolPart("edit", { filePath: "src/bar.ts" })]),
    ];
    const result = extractSessionFiles(messages);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      action: "modified",
      name: "bar.ts",
    });
  });

  it("classifies read as read", () => {
    const messages = [
      makeMessage([makeToolPart("read", { filePath: "src/baz.ts" })]),
    ];
    const result = extractSessionFiles(messages);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ action: "read" });
  });

  it("deduplicates same file across multiple tool calls", () => {
    const messages = [
      makeMessage([
        makeToolPart("read", { filePath: "src/foo.ts" }),
        makeToolPart("edit", { filePath: "src/foo.ts" }),
      ]),
    ];
    const result = extractSessionFiles(messages);
    expect(result).toHaveLength(1);
    expect(result[0].count).toBe(2);
  });

  it("promotes action to most significant (read then edit = modified)", () => {
    const messages = [
      makeMessage([
        makeToolPart("read", { filePath: "src/foo.ts" }),
        makeToolPart("edit", { filePath: "src/foo.ts" }),
      ]),
    ];
    const result = extractSessionFiles(messages);
    expect(result[0].action).toBe("modified");
  });

  it("promotes action to created when write is first touch", () => {
    const messages = [
      makeMessage([
        makeToolPart("write", { filePath: "src/new.ts" }),
        makeToolPart("edit", { filePath: "src/new.ts" }),
      ]),
    ];
    const result = extractSessionFiles(messages);
    expect(result[0].action).toBe("created");
  });

  it("skips tool parts with no filePath", () => {
    const messages = [
      makeMessage([
        makeToolPart("bash", { command: "ls" }),
        makeToolPart("write", { filePath: "src/ok.ts" }),
      ]),
    ];
    const result = extractSessionFiles(messages);
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe("src/ok.ts");
  });

  it("skips unknown tools even with filePath", () => {
    const messages = [
      makeMessage([
        makeToolPart("some_unknown_tool", { filePath: "src/x.ts" }),
      ]),
    ];
    expect(extractSessionFiles(messages)).toHaveLength(0);
  });

  it("sorts modified/created before read files", () => {
    const messages = [
      makeMessage([
        makeToolPart("read", { filePath: "a.ts" }),
        makeToolPart("write", { filePath: "b.ts" }),
        makeToolPart("read", { filePath: "c.ts" }),
      ]),
    ];
    const result = extractSessionFiles(messages);
    expect(result.map((f) => f.path)).toEqual(["b.ts", "c.ts", "a.ts"]);
  });

  it("extracts filePath from alternative input keys", () => {
    const messages = [
      makeMessage([makeToolPart("read", { path: "via-path.ts" })]),
    ];
    const result = extractSessionFiles(messages);
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe("via-path.ts");
  });

  it("handles ast_grep_replace as modified", () => {
    const messages = [
      makeMessage([
        makeToolPart("ast_grep_replace", { filePath: "src/refactored.ts" }),
      ]),
    ];
    const result = extractSessionFiles(messages);
    expect(result[0].action).toBe("modified");
  });

  it("handles running tool state", () => {
    const messages = [
      makeMessage([
        makeToolPart("write", { filePath: "src/wip.ts" }, "running"),
      ]),
    ];
    const result = extractSessionFiles(messages);
    expect(result).toHaveLength(1);
    expect(result[0].action).toBe("created");
  });

  it("classifies apply_patch (edit set) with filePath as modified", () => {
    const messages = [
      makeMessage([makeToolPart("apply_patch", { filePath: "src/ap.ts" })]),
    ];
    const result = extractSessionFiles(messages);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ path: "src/ap.ts", action: "modified" });
  });

  it("heuristic: unknown mcp_edit_file with path classifies as modified", () => {
    const messages = [
      makeMessage([makeToolPart("mcp_edit_file", { path: "src/mcp.ts" })]),
    ];
    const result = extractSessionFiles(messages);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ path: "src/mcp.ts", action: "modified" });
  });

  it("heuristic: unknown my_write_tool on first touch classifies as created", () => {
    const messages = [
      makeMessage([makeToolPart("my_write_tool", { filePath: "src/mw.ts" })]),
    ];
    const result = extractSessionFiles(messages);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ path: "src/mw.ts", action: "created" });
  });

  it("heuristic decoy: mcp_read_file with path is not present", () => {
    const messages = [
      makeMessage([makeToolPart("mcp_read_file", { path: "src/decoy1.ts" })]),
    ];
    expect(extractSessionFiles(messages)).toHaveLength(0);
  });

  it("heuristic decoy: get_file_contents is not present", () => {
    const messages = [
      makeMessage([
        makeToolPart("get_file_contents", { path: "src/decoy2.ts" }),
      ]),
    ];
    expect(extractSessionFiles(messages)).toHaveLength(0);
  });

  it("heuristic decoy: credit_file (token boundary) is not present", () => {
    const messages = [
      makeMessage([makeToolPart("credit_file", { path: "src/decoy3.ts" })]),
    ];
    expect(extractSessionFiles(messages)).toHaveLength(0);
  });

  it("heuristic decoy: reapply_metadata (token boundary) is not present", () => {
    const messages = [
      makeMessage([
        makeToolPart("reapply_metadata", { path: "src/decoy4.ts" }),
      ]),
    ];
    expect(extractSessionFiles(messages)).toHaveLength(0);
  });
});

describe("extractSessionFilesMulti", () => {
  it("merges parent read + child edit of same file into one modified entry, count 2", () => {
    const parent = [makeMessage([makeToolPart("read", { filePath: "A.ts" })])];
    const child = [makeMessage([makeToolPart("edit", { filePath: "A.ts" })])];
    const result = extractSessionFilesMulti([parent, child]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      path: "A.ts",
      action: "modified",
      count: 2,
    });
  });

  it("includes child-only files in output", () => {
    const parent = [makeMessage([makeToolPart("read", { filePath: "A.ts" })])];
    const child = [makeMessage([makeToolPart("write", { filePath: "B.ts" })])];
    const result = extractSessionFilesMulti([parent, child]);
    expect(result.map((f) => f.path).sort()).toEqual(["A.ts", "B.ts"]);
    expect(result.find((f) => f.path === "B.ts")?.action).toBe("created");
  });

  it("single source equals extractSessionFiles for a fixture with all action types", () => {
    const fixture = [
      makeMessage([
        makeToolPart("read", { filePath: "r.ts" }),
        makeToolPart("write", { filePath: "w.ts" }),
        makeToolPart("edit", { filePath: "e.ts" }),
        makeToolPart("read", { filePath: "w.ts" }),
      ]),
    ];
    expect(extractSessionFilesMulti([fixture])).toEqual(
      extractSessionFiles(fixture),
    );
  });

  it("tolerates empty child arrays", () => {
    const parent = [makeMessage([makeToolPart("write", { filePath: "A.ts" })])];
    const result = extractSessionFilesMulti([parent, [], []]);
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe("A.ts");
  });
});

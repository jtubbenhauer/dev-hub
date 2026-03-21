import { describe, it, expect } from "vitest";
import { stripSoleCodeFence } from "@/components/chat/message";

describe("stripSoleCodeFence", () => {
  it("unwraps the actual orchestration message from the DB", () => {
    const input = [
      "---",
      "",
      "```",
      "ORCHESTRATION COMPLETE \u2014 ALL TASKS DONE",
      "",
      "PLAN: storybook-mockgen",
      "COMPLETED: 8/8 tasks + F1 APPROVE",
      "",
      "COMMITS THIS SESSION:",
      "  5968909be0 refactor(ng-accounting): replace MockGenerator calls",
      "",
      "FILES MODIFIED: 8",
      "REMAINING: 0",
      "```",
    ].join("\n");

    const result = stripSoleCodeFence(input);
    expect(result).not.toContain("```");
    expect(result).toContain("ORCHESTRATION COMPLETE");
    expect(result.startsWith("---")).toBe(true);
  });

  it("unwraps a bare code fence wrapping plain-text summary", () => {
    const input =
      "```\nTASK COMPLETE\n\nFiles changed: 3\nTests passed: 12\n```";
    expect(stripSoleCodeFence(input)).toBe(
      "TASK COMPLETE\n\nFiles changed: 3\nTests passed: 12",
    );
  });

  it("unwraps a bare code fence containing markdown headers", () => {
    const input =
      "```\n# ORCHESTRATION COMPLETE\n\n- Task 1: Done\n- Task 2: Done\n```";
    expect(stripSoleCodeFence(input)).toBe(
      "# ORCHESTRATION COMPLETE\n\n- Task 1: Done\n- Task 2: Done",
    );
  });

  it("unwraps a bare code fence containing bold text and lists", () => {
    const input =
      "```\n**Summary**: All tasks finished.\n\n1. First thing\n2. Second thing\n```";
    expect(stripSoleCodeFence(input)).toBe(
      "**Summary**: All tasks finished.\n\n1. First thing\n2. Second thing",
    );
  });

  it("preserves prefix content before the fence", () => {
    const input = "---\n\n```\nSome summary\nMore text\n```";
    expect(stripSoleCodeFence(input)).toBe("---\n\nSome summary\nMore text");
  });

  it("preserves fenced code blocks with a language specifier", () => {
    const input = "```python\nprint('hello')\n```";
    expect(stripSoleCodeFence(input)).toBe(input);
  });

  it("preserves fenced code that looks like real code (2+ signals)", () => {
    const input =
      "```\nimport { foo } from 'bar';\nconst x = foo();\nconsole.log(x);\n```";
    expect(stripSoleCodeFence(input)).toBe(input);
  });

  it("preserves code with function definitions and braces", () => {
    const input =
      "```\nfunction greet(name) {\n  return `Hello ${name}`;\n}\n```";
    expect(stripSoleCodeFence(input)).toBe(input);
  });

  it("preserves content with nested code fences", () => {
    const input = "```\n# Title\n\n```bash\nnpm test\n```\n\n- Done\n```";
    expect(stripSoleCodeFence(input)).toBe(input);
  });

  it("returns plain text unchanged (no fence)", () => {
    const input = "Just some normal markdown\n\n## With headers";
    expect(stripSoleCodeFence(input)).toBe(input);
  });

  it("returns text not ending with ``` unchanged", () => {
    const input = "```\nopen fence but no close";
    expect(stripSoleCodeFence(input)).toBe(input);
  });

  it("handles surrounding whitespace", () => {
    const input = "  \n```\nReport summary\nAll clear\n```\n  ";
    expect(stripSoleCodeFence(input)).toBe("Report summary\nAll clear");
  });

  it("strips empty bare fences to empty string", () => {
    expect(stripSoleCodeFence("```\n```")).toBe("");
  });

  it("returns a single-line fence unchanged", () => {
    expect(stripSoleCodeFence("```")).toBe("```");
  });

  it("unwraps single-signal code that doesn't meet the 2-signal threshold", () => {
    const input = "```\nRun the deploy:\nnpm run build\nDone.\n```";
    expect(stripSoleCodeFence(input)).toBe(
      "Run the deploy:\nnpm run build\nDone.",
    );
  });
});

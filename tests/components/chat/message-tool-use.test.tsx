import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import { MessageToolUse } from "@/components/chat/message-tool-use";
import type { ToolPart } from "@/lib/opencode/types";

function makeRunningBashPart(command: string): ToolPart {
  return {
    id: "part-1",
    sessionID: "sess-1",
    messageID: "msg-1",
    type: "tool",
    tool: "bash",
    state: {
      status: "running",
      input: { command },
    },
  } as unknown as ToolPart;
}

afterEach(() => {
  cleanup();
});

describe("MessageToolUse - expanded ToolParams", () => {
  it("shows the full bash command when the tool call is expanded (running state)", () => {
    const longCommand =
      "pkill -TERM -f '[o]pencode serve' && sleep 3 && npm run start:opencode:server -- --port 9999 --workspace /very/long/path/to/some/deeply/nested/workspace/directory";
    expect(longCommand.length).toBeGreaterThan(80);

    render(<MessageToolUse part={makeRunningBashPart(longCommand)} />);

    expect(screen.getByText(longCommand)).toBeInTheDocument();
  });

  it("does not truncate the value with an ellipsis in the expanded params view", () => {
    const longCommand = "a".repeat(200);

    render(<MessageToolUse part={makeRunningBashPart(longCommand)} />);

    const valueEl = screen.getByText(longCommand);
    expect(valueEl.textContent).toBe(longCommand);
    expect(valueEl.textContent).not.toContain("…");
    expect(valueEl.className).not.toMatch(/\btruncate\b/);
  });

  it("preserves newlines in a multi-line command instead of collapsing them to spaces", () => {
    const multiLine =
      "echo 'first line'\necho 'second line'\necho 'third line'";

    render(<MessageToolUse part={makeRunningBashPart(multiLine)} />);

    const valueEl = screen.getByText((_, el) => el?.textContent === multiLine);
    expect(valueEl.textContent).toBe(multiLine);
    expect(valueEl.textContent).toContain("\n");
  });
});

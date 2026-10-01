import {
  formatTranscript,
  type TranscriptOptions,
  type TranscriptSession,
} from "@/lib/opencode/session-transcript";
import type { Message, MessageWithParts, Part } from "@/lib/opencode/types";

type AssistantInfo = Extract<Message, { role: "assistant" }>;

const SESSION: TranscriptSession = {
  id: "ses_abc123",
  title: "Fix the build",
  time: {
    created: Date.UTC(2026, 0, 2, 3, 4, 5),
    updated: Date.UTC(2026, 0, 2, 4, 0, 0),
  },
};

const ALL_DETAILS: TranscriptOptions = {
  thinking: true,
  toolDetails: true,
  assistantMetadata: true,
  providers: [
    { id: "anthropic", models: { "claude-x": { name: "Claude X" } } },
  ],
};

function userMessage(id: string, created: number, text: string) {
  const message: MessageWithParts = {
    info: {
      id,
      sessionID: SESSION.id,
      role: "user",
      time: { created },
      agent: "build",
      model: { providerID: "anthropic", modelID: "claude-x" },
    },
    parts: [textPart(id, text)],
  };
  return message;
}

function assistantInfo(id: string): AssistantInfo {
  return {
    id,
    sessionID: SESSION.id,
    role: "assistant",
    time: { created: 2_000, completed: 3_500 },
    parentID: "msg_user",
    modelID: "claude-x",
    providerID: "anthropic",
    mode: "build",
    path: { cwd: "/repo", root: "/repo" },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  };
}

function textPart(messageID: string, text: string, synthetic = false): Part {
  return {
    id: `${messageID}-text-${text.length}`,
    sessionID: SESSION.id,
    messageID,
    type: "text",
    text,
    synthetic,
  };
}

function reasoningPart(messageID: string, text: string): Part {
  return {
    id: `${messageID}-reasoning`,
    sessionID: SESSION.id,
    messageID,
    type: "reasoning",
    text,
    time: { start: 1 },
  };
}

function completedToolPart(
  messageID: string,
  input: Record<string, unknown>,
  output: string,
): Part {
  return {
    id: `${messageID}-bash`,
    sessionID: SESSION.id,
    messageID,
    type: "tool",
    callID: "call-bash",
    tool: "bash",
    state: {
      status: "completed",
      input,
      output,
      title: "bash",
      metadata: {},
      time: { start: 1, end: 2 },
    },
  };
}

function failedToolPart(
  messageID: string,
  input: Record<string, unknown>,
  error: string,
): Part {
  return {
    id: `${messageID}-read`,
    sessionID: SESSION.id,
    messageID,
    type: "tool",
    callID: "call-read",
    tool: "read",
    state: { status: "error", input, error, time: { start: 1, end: 2 } },
  };
}

describe("formatTranscript", () => {
  it("renders the TUI layout with messages in chronological order", () => {
    const user = userMessage("msg_1", 1_000, "Why is the build red?");
    const assistant: MessageWithParts = {
      info: assistantInfo("msg_2"),
      parts: [textPart("msg_2", "A missing import.")],
    };

    const transcript = formatTranscript(
      SESSION,
      [assistant, user],
      ALL_DETAILS,
    );

    expect(transcript).toBe(
      "# Fix the build\n\n" +
        "**Session ID:** ses_abc123\n" +
        `**Created:** ${new Date(SESSION.time.created).toLocaleString()}\n` +
        `**Updated:** ${new Date(SESSION.time.updated).toLocaleString()}\n\n` +
        "---\n\n" +
        "## User\n\nWhy is the build red?\n\n---\n\n" +
        "## Assistant (Build · Claude X · 1.5s)\n\nA missing import.\n\n---\n\n",
    );
  });

  it("titles the agent from `agent` and falls back to the model ID for unknown providers", () => {
    const info: AssistantInfo & { agent: string } = {
      ...assistantInfo("msg_2"),
      agent: "sisyphus - ultraworker",
      providerID: "unknown-provider",
      modelID: "mystery-model",
      time: { created: 2_000 },
    };

    const transcript = formatTranscript(
      SESSION,
      [{ info, parts: [] }],
      ALL_DETAILS,
    );

    expect(transcript).toContain(
      "## Assistant (Sisyphus - Ultraworker · mystery-model)\n\n",
    );
  });

  it("drops the assistant metadata when it is turned off", () => {
    const assistant: MessageWithParts = {
      info: assistantInfo("msg_2"),
      parts: [textPart("msg_2", "Done.")],
    };

    const transcript = formatTranscript(SESSION, [assistant], {
      ...ALL_DETAILS,
      assistantMetadata: false,
    });

    expect(transcript).toContain("---\n\n## Assistant\n\nDone.\n\n---\n\n");
  });

  it("includes reasoning when thinking is on", () => {
    const assistant: MessageWithParts = {
      info: assistantInfo("msg_2"),
      parts: [reasoningPart("msg_2", "Check the imports first.")],
    };

    const transcript = formatTranscript(SESSION, [assistant], ALL_DETAILS);

    expect(transcript).toContain("_Thinking:_\n\nCheck the imports first.\n\n");
  });

  it("leaves reasoning out when thinking is off", () => {
    const assistant: MessageWithParts = {
      info: assistantInfo("msg_2"),
      parts: [reasoningPart("msg_2", "Check the imports first.")],
    };

    const transcript = formatTranscript(SESSION, [assistant], {
      ...ALL_DETAILS,
      thinking: false,
    });

    expect(transcript).not.toContain("Check the imports first.");
  });

  it("writes tool input, output and errors when tool details are on", () => {
    const assistant: MessageWithParts = {
      info: assistantInfo("msg_2"),
      parts: [
        completedToolPart("msg_2", { command: "pnpm build" }, "Build failed"),
        failedToolPart("msg_2", { filePath: "a.ts" }, "ENOENT"),
      ],
    };

    const transcript = formatTranscript(SESSION, [assistant], ALL_DETAILS);

    expect(transcript).toContain(
      "**Tool: bash**\n\n**Input:**\n```json\n{\n" +
        '  "command": "pnpm build"\n}\n```\n\n' +
        "**Output:**\n```\nBuild failed\n```\n\n" +
        "**Tool: read**\n\n**Input:**\n```json\n{\n" +
        '  "filePath": "a.ts"\n}\n```\n\n' +
        "**Error:**\n```\nENOENT\n```\n\n",
    );
  });

  it("lists only tool names when tool details are off", () => {
    const assistant: MessageWithParts = {
      info: assistantInfo("msg_2"),
      parts: [
        completedToolPart("msg_2", { command: "pnpm build" }, "Build failed"),
      ],
    };

    const transcript = formatTranscript(SESSION, [assistant], {
      ...ALL_DETAILS,
      toolDetails: false,
    });

    expect(transcript).toContain(
      "## Assistant (Build · Claude X · 1.5s)\n\n**Tool: bash**\n\n---",
    );
  });

  it("skips synthetic text and the part types the TUI leaves out", () => {
    const assistant: MessageWithParts = {
      info: assistantInfo("msg_2"),
      parts: [
        textPart("msg_2", "Injected context", true),
        {
          id: "msg_2-step",
          sessionID: SESSION.id,
          messageID: "msg_2",
          type: "step-start",
        },
        textPart("msg_2", "Real answer"),
      ],
    };

    const transcript = formatTranscript(SESSION, [assistant], ALL_DETAILS);

    expect(transcript).toContain(
      "## Assistant (Build · Claude X · 1.5s)\n\nReal answer\n\n---",
    );
  });
});

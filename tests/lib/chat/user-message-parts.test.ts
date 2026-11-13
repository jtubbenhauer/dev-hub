import { describe, expect, it } from "vitest";
import { createAttachmentPromptPart } from "@/lib/attachment-utils";
import { splitUserMessageParts } from "@/lib/chat/user-message-parts";
import type { Part } from "@/lib/opencode/types";

function textPart(
  id: string,
  text: string,
  flags: { synthetic?: boolean; ignored?: boolean } = {},
): Part {
  return {
    id,
    sessionID: "ses-1",
    messageID: "msg-1",
    type: "text",
    text,
    ...flags,
  };
}

const SUPERMEMORY_CONTEXT = [
  "[SUPERMEMORY]",
  "",
  "Recent Context:",
  "- [2026-11-12] git_master.include_co_authored_by is set to false.",
  "",
  "[SUPERMEMORY UPDATE]",
  "Supermemory update available: v2.0.13 -> v2.1.2",
  "Run (if you have a JS runtime): bunx opencode-supermemory@latest install",
].join("\n");

const RECALL_DIRECTIVE =
  "<supermemory-recall>\nBefore responding, silently decide whether recalling saved memory would help.\n</supermemory-recall>";

function inlinedAttachmentText(filename: string, content: string): string {
  const part = createAttachmentPromptPart({
    mime: "text/plain",
    dataUrl: `data:text/plain;base64,${btoa(content)}`,
    filename,
  });
  if (part.type !== "text") throw new Error("expected an inlined text part");
  return part.text;
}

describe("splitUserMessageParts", () => {
  it("keeps only the typed text in the bubble and moves plugin text aside", () => {
    const content = splitUserMessageParts([
      textPart("prt-typed", "Why does scrolling stutter?"),
      textPart("prt-context", SUPERMEMORY_CONTEXT, { synthetic: true }),
      textPart("prt-recall", RECALL_DIRECTIVE, { synthetic: true }),
    ]);

    expect(content.text).toBe("Why does scrolling stutter?");
    expect(content.injectedBlocks.map((block) => block.id)).toEqual([
      "prt-context",
      "prt-recall",
    ]);
    expect(content.attachments).toEqual([]);
  });

  it("pulls update notices out of injected text", () => {
    const content = splitUserMessageParts([
      textPart("prt-typed", "hi"),
      textPart("prt-context", SUPERMEMORY_CONTEXT, { synthetic: true }),
    ]);

    expect(content.notices).toEqual([
      "Supermemory update available: v2.0.13 -> v2.1.2\nRun (if you have a JS runtime): bunx opencode-supermemory@latest install",
    ]);
  });

  it("does not treat typed text that looks like a notice as one", () => {
    const content = splitUserMessageParts([
      textPart("prt-typed", "[SUPERMEMORY UPDATE]\nwhat does this mean?"),
    ]);

    expect(content.notices).toEqual([]);
    expect(content.text).toBe("[SUPERMEMORY UPDATE]\nwhat does this mean?");
  });

  it("shows dev-hub's inlined attachments by filename instead of their content", () => {
    const content = splitUserMessageParts([
      textPart("prt-typed", "summarise these"),
      textPart("prt-csv", inlinedAttachmentText("rows.csv", "a,b\n1,2"), {
        synthetic: true,
      }),
      textPart(
        "prt-docx",
        inlinedAttachmentText('memo "final".docx', "Codeword"),
        { synthetic: true },
      ),
    ]);

    expect(content.attachments).toEqual([
      { id: "prt-csv", filename: "rows.csv" },
      { id: "prt-docx", filename: 'memo "final".docx' },
    ]);
    expect(content.injectedBlocks).toEqual([]);
    expect(content.text).toBe("summarise these");
  });

  it("skips ignored parts and joins several typed parts on separate lines", () => {
    const content = splitUserMessageParts([
      textPart("prt-a", "first"),
      textPart("prt-ignored", "compaction leftovers", { ignored: true }),
      textPart("prt-b", "second"),
    ]);

    expect(content.text).toBe("first\nsecond");
    expect(content.injectedBlocks).toEqual([]);
  });

  it("returns empty text for a turn made only of injected text", () => {
    const content = splitUserMessageParts([
      textPart("prt-recall", RECALL_DIRECTIVE, { synthetic: true }),
    ]);

    expect(content.text).toBe("");
    expect(content.injectedBlocks).toHaveLength(1);
  });
});

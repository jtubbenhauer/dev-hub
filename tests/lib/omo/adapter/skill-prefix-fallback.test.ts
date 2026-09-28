import { describe, expect, it } from "vitest";
import { createLiveAdapter } from "@/lib/omo/adapter/live-events";
import type { Event, TextPart } from "@/lib/opencode/types";

function textParts(events: readonly Event[]): TextPart[] {
  return events.flatMap((event) =>
    event.type === "message.part.updated" &&
    event.properties.part.type === "text"
      ? [event.properties.part]
      : [],
  );
}

describe("live adapter skill-prefix fallback", () => {
  it("detects $skill-name via regex when no catalog skill names are known", () => {
    const adapter = createLiveAdapter({
      sessionId: "omo_fallback-1",
      workspaceId: "workspace-1",
      workspacePath: "/workspace",
      skillPrefixes: [],
    });

    const result = adapter.handle({
      type: "message_start",
      message: { role: "user", content: "$ulw-plan hello", timestamp: 1_000 },
    });

    const [part] = textParts(result.events);
    const userUpdate = result.events.find(
      (event) => event.type === "message.updated",
    );

    expect(part?.text).toBe("hello");
    expect(userUpdate).toMatchObject({
      properties: { info: { agent: "skill:ulw-plan" } },
    });
  });

  it("prefers an exact catalog skill name over the generic regex fallback", () => {
    const adapter = createLiveAdapter({
      sessionId: "omo_fallback-2",
      workspaceId: "workspace-1",
      workspacePath: "/workspace",
      skillPrefixes: ["frontend"],
    });

    const result = adapter.handle({
      type: "message_start",
      message: {
        role: "user",
        content: "$unknown-skill hello",
        timestamp: 1_000,
      },
    });

    const [part] = textParts(result.events);
    const userUpdate = result.events.find(
      (event) => event.type === "message.updated",
    );

    expect(part?.text).toBe("$unknown-skill hello");
    expect(userUpdate).toMatchObject({
      properties: { info: { agent: "omo" } },
    });
  });
});

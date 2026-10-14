// @vitest-environment node

import { describe, expect, it } from "vitest";
import { engineForSessionId } from "@/lib/engine/types";

describe("engineForSessionId", () => {
  it.each([
    { sessionId: "omo_01a13a2a-faa8-7701-9e00-d4b573afab20", engine: "omo" },
    { sessionId: "ses_3f2a9c1b7e", engine: "opencode" },
    { sessionId: "optimistic-1", engine: "opencode" },
  ])("treats $sessionId as an $engine session", ({ sessionId, engine }) => {
    expect(engineForSessionId(sessionId)).toBe(engine);
  });
});

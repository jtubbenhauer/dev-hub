// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  getOmoSkillName,
  isOmoSkillAgentName,
  OMO_NO_MODE_AGENT,
  OMO_SKILL_AGENT_PREFIX,
} from "@/lib/engine/omo-mode";

describe("omo mode helpers", () => {
  it("recognises facade skill agents by their skill: prefix", () => {
    expect(OMO_SKILL_AGENT_PREFIX).toBe("skill:");
    expect(isOmoSkillAgentName("skill:ulw-plan")).toBe(true);
    expect(isOmoSkillAgentName("code")).toBe(false);
    expect(isOmoSkillAgentName(OMO_NO_MODE_AGENT)).toBe(false);
  });

  it("strips the skill: prefix for display and leaves other names alone", () => {
    expect(getOmoSkillName("skill:ulw-plan")).toBe("ulw-plan");
    expect(getOmoSkillName("build")).toBe("build");
  });

  it("uses the agent name the omo adapter records for skill-less prompts", () => {
    expect(OMO_NO_MODE_AGENT).toBe("omo");
  });
});

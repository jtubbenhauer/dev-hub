// Mirrors the omo facade: `/agent` lists skills as `skill:<name>` and history
// labels prompts sent without a skill as agent "omo".
export const OMO_SKILL_AGENT_PREFIX = "skill:";

export const OMO_NO_MODE_AGENT = "omo";

export function isOmoSkillAgentName(agentName: string): boolean {
  return agentName.startsWith(OMO_SKILL_AGENT_PREFIX);
}

export function getOmoSkillName(agentName: string): string {
  return isOmoSkillAgentName(agentName)
    ? agentName.slice(OMO_SKILL_AGENT_PREFIX.length)
    : agentName;
}

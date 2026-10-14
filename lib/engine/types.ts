export const CHAT_ENGINES = ["opencode", "omo"] as const;

export type ChatEngine = (typeof CHAT_ENGINES)[number];

export const CHAT_ENGINE_SETTING_KEY = "chat-engine";

export function isChatEngine(value: unknown): value is ChatEngine {
  return value === "opencode" || value === "omo";
}

export function engineForSessionId(sessionId: string): ChatEngine {
  return sessionId.startsWith("omo_") ? "omo" : "opencode";
}

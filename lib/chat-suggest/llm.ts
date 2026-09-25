import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ChatSuggestMessage } from "@/lib/chat-suggest/prompts";

export interface ChatSuggestConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

// OpenRouter-only request options: route to the fastest provider (Groq/Cerebras
// for gpt-oss) and keep reasoning short and out of the response.
export function getProviderSpecificOptions(
  config: ChatSuggestConfig,
): Record<string, unknown> {
  if (config.baseUrl !== DEFAULT_BASE_URL) return {};
  const isGptOssModel = config.model.startsWith("openai/gpt-oss");
  return {
    provider: { sort: "latency" },
    ...(isGptOssModel ? { reasoning: { effort: "low", exclude: true } } : {}),
  };
}

const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_MODEL = "openai/gpt-oss-120b";
const REQUEST_TIMEOUT_MS = 8000;

function getOpenCodeAuthPath(): string {
  const dataHome =
    process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");
  return path.join(dataHome, "opencode", "auth.json");
}

async function readOpenCodeOpenRouterKey(): Promise<string | null> {
  try {
    const raw = await readFile(getOpenCodeAuthPath(), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const openRouterEntry = (parsed as Record<string, unknown>).openrouter;
    if (typeof openRouterEntry !== "object" || openRouterEntry === null) {
      return null;
    }
    const key = (openRouterEntry as Record<string, unknown>).key;
    return typeof key === "string" && key ? key : null;
  } catch {
    return null;
  }
}

export async function resolveChatSuggestConfig(): Promise<ChatSuggestConfig | null> {
  if (process.env.CHAT_SUGGEST_DISABLED === "true") return null;
  const baseUrl = process.env.CHAT_SUGGEST_BASE_URL || DEFAULT_BASE_URL;
  const model = process.env.CHAT_SUGGEST_MODEL || DEFAULT_MODEL;
  const apiKey =
    process.env.CHAT_SUGGEST_API_KEY ||
    process.env.OPENROUTER_API_KEY ||
    (baseUrl === DEFAULT_BASE_URL ? await readOpenCodeOpenRouterKey() : null);
  if (!apiKey) return null;
  return { baseUrl, apiKey, model };
}

interface ChatCompletionResponse {
  choices?: { message?: { content?: string | null } }[];
}

export async function requestChatCompletion(
  config: ChatSuggestConfig,
  messages: ChatSuggestMessage[],
  options: { maxTokens: number; temperature: number; signal?: AbortSignal },
): Promise<string> {
  const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const signal = options.signal
    ? AbortSignal.any([options.signal, timeoutSignal])
    : timeoutSignal;
  const response = await fetch(
    `${config.baseUrl.replace(/\/$/, "")}/chat/completions`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        ...getProviderSpecificOptions(config),
        model: config.model,
        messages,
        max_tokens: options.maxTokens,
        temperature: options.temperature,
      }),
      signal,
    },
  );
  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(
      `Chat suggest request failed (${response.status}): ${errorBody.slice(0, 200)}`,
    );
  }
  const data = (await response.json()) as ChatCompletionResponse;
  return data.choices?.[0]?.message?.content ?? "";
}

// @vitest-environment node
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  getProviderSpecificOptions,
  resolveChatSuggestConfig,
} from "@/lib/chat-suggest/llm";

const OPENROUTER_URL = "https://openrouter.ai/api/v1";

describe("resolveChatSuggestConfig", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("defaults to gpt-oss-120b on OpenRouter", async () => {
    vi.stubEnv("CHAT_SUGGEST_API_KEY", "test-key");
    vi.stubEnv("CHAT_SUGGEST_MODEL", "");
    vi.stubEnv("CHAT_SUGGEST_BASE_URL", "");
    expect(await resolveChatSuggestConfig()).toEqual({
      baseUrl: OPENROUTER_URL,
      apiKey: "test-key",
      model: "openai/gpt-oss-120b",
    });
  });

  it("returns null when disabled by env", async () => {
    vi.stubEnv("CHAT_SUGGEST_API_KEY", "test-key");
    vi.stubEnv("CHAT_SUGGEST_DISABLED", "true");
    expect(await resolveChatSuggestConfig()).toBeNull();
  });
});

describe("getProviderSpecificOptions", () => {
  it("routes gpt-oss on OpenRouter to the lowest-latency provider with low reasoning", () => {
    expect(
      getProviderSpecificOptions({
        baseUrl: OPENROUTER_URL,
        apiKey: "k",
        model: "openai/gpt-oss-120b",
      }),
    ).toEqual({
      provider: { sort: "latency" },
      reasoning: { effort: "low", exclude: true },
    });
  });

  it("does not enable reasoning for other OpenRouter models", () => {
    expect(
      getProviderSpecificOptions({
        baseUrl: OPENROUTER_URL,
        apiKey: "k",
        model: "anthropic/claude-haiku-4.5",
      }),
    ).toEqual({ provider: { sort: "latency" } });
  });

  it("sends no OpenRouter-specific options to other endpoints", () => {
    expect(
      getProviderSpecificOptions({
        baseUrl: "http://localhost:11434/v1",
        apiKey: "k",
        model: "openai/gpt-oss-120b",
      }),
    ).toEqual({});
  });
});

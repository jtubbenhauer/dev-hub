// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { mockAuth, mockResolveConfig, mockRequestCompletion, mockSettingRows } =
  vi.hoisted(() => ({
    mockAuth: vi.fn(),
    mockResolveConfig: vi.fn(),
    mockRequestCompletion: vi.fn(),
    mockSettingRows: vi.fn(),
  }));

vi.mock("@/lib/auth/config", () => ({ auth: mockAuth }));
vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: mockSettingRows }) }),
  },
}));
vi.mock("@/lib/chat-suggest/llm", () => ({
  resolveChatSuggestConfig: mockResolveConfig,
  requestChatCompletion: mockRequestCompletion,
}));

import { POST } from "@/app/api/chat-suggest/route";

function makeRequest(body: unknown) {
  return new NextRequest("http://localhost/api/chat-suggest", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

const validContext = {
  lastAgentMessage: "Recommended next steps: tool data first.",
  recentUserMessages: ["ok cool"],
};

describe("POST /api/chat-suggest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ user: { id: "user-1" } });
    mockSettingRows.mockResolvedValue([]);
    mockResolveConfig.mockResolvedValue({
      baseUrl: "https://example.test/v1",
      apiKey: "key",
      model: "test-model",
    });
  });

  it("rejects unauthenticated requests", async () => {
    mockAuth.mockResolvedValue(null);
    const response = await POST(makeRequest({ mode: "replies" }));
    expect(response.status).toBe(401);
  });

  it("rejects invalid bodies", async () => {
    expect((await POST(makeRequest({ mode: "other" }))).status).toBe(400);
    expect(
      (await POST(makeRequest({ mode: "complete", ...validContext }))).status,
    ).toBe(400);
  });

  it("refuses to call the model when the user disabled suggestions", async () => {
    mockSettingRows.mockResolvedValue([{ value: false }]);
    const response = await POST(
      makeRequest({ mode: "replies", ...validContext }),
    );
    expect(response.status).toBe(403);
    expect(mockRequestCompletion).not.toHaveBeenCalled();
  });

  it("treats an explicit true setting as enabled", async () => {
    mockSettingRows.mockResolvedValue([{ value: true }]);
    mockRequestCompletion.mockResolvedValue('["Ok"]');
    const response = await POST(
      makeRequest({ mode: "replies", ...validContext }),
    );
    expect(response.status).toBe(200);
  });

  it("reports disabled when no model is configured", async () => {
    mockResolveConfig.mockResolvedValue(null);
    const response = await POST(
      makeRequest({ mode: "replies", ...validContext }),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ disabled: true });
  });

  it("returns parsed reply suggestions", async () => {
    mockRequestCompletion.mockResolvedValue(
      '["Ok great, let\'s do the recommended next steps.", "Why A15?"]',
    );
    const response = await POST(
      makeRequest({ mode: "replies", ...validContext }),
    );
    expect(await response.json()).toEqual({
      replies: ["Ok great, let's do the recommended next steps.", "Why A15?"],
    });
  });

  it("returns only the continuation for live completions", async () => {
    mockRequestCompletion.mockResolvedValue(
      "The model misreadings should be done first.",
    );
    const response = await POST(
      makeRequest({
        mode: "complete",
        typedText: "The model mis",
        ...validContext,
      }),
    );
    expect(await response.json()).toEqual({
      completion: "readings should be done first.",
    });
  });

  it("returns 502 when the model call fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockRequestCompletion.mockRejectedValue(new Error("boom"));
    const response = await POST(
      makeRequest({ mode: "replies", ...validContext }),
    );
    expect(response.status).toBe(502);
  });
});

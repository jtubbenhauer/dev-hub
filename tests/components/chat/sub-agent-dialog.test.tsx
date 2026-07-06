import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";

import { SubAgentDialog } from "@/components/chat/sub-agent-dialog";
import type { MessageWithParts, Message } from "@/lib/opencode/types";

function makeAssistantMessage(
  id: string,
  modelID: string,
  providerID: string,
): MessageWithParts {
  return {
    info: {
      id,
      sessionID: "sub-1",
      role: "assistant",
      time: { created: Date.now() },
      parentID: "",
      modelID,
      providerID,
      mode: "",
      path: { cwd: "", root: "" },
      cost: 0,
      tokens: {
        input: 0,
        output: 0,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      },
    } as Message,
    parts: [],
  };
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
  mockFetch.mockReset();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("SubAgentDialog - model badge", () => {
  it("renders the modelID badge when an assistant message has a modelID", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse([
        makeAssistantMessage("msg-1", "claude-opus-4-7", "anthropic"),
      ]),
    );

    render(
      <SubAgentDialog
        childSessionId="sub-1"
        workspaceId="ws-1"
        description="Sub-agent task"
        isActive={false}
        open={true}
        onOpenChange={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("claude-opus-4-7")).toBeInTheDocument();
    });

    // Provider is exposed via the tooltip title for reference
    const badge = screen.getByText("claude-opus-4-7");
    expect(badge).toHaveAttribute("title", "anthropic / claude-opus-4-7");
  });

  it("does not render a model badge when messages carry no modelID", async () => {
    mockFetch.mockResolvedValue(jsonResponse([]));

    render(
      <SubAgentDialog
        childSessionId="sub-1"
        workspaceId="ws-1"
        description="Sub-agent task"
        isActive={false}
        open={true}
        onOpenChange={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalled();
    });

    expect(
      screen.queryByText(
        (_, el) => el?.getAttribute("title")?.includes(" / ") ?? false,
      ),
    ).not.toBeInTheDocument();
  });

  it("skips placeholder assistant messages (empty modelID) and uses the first real one", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse([
        makeAssistantMessage("msg-placeholder", "", ""),
        makeAssistantMessage("msg-real", "gpt-4", "openai"),
      ]),
    );

    render(
      <SubAgentDialog
        childSessionId="sub-1"
        workspaceId="ws-1"
        description="Sub-agent task"
        isActive={false}
        open={true}
        onOpenChange={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("gpt-4")).toBeInTheDocument();
    });
  });
});

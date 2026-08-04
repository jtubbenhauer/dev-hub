/**
 * Regression tests for the session-switch variant race.
 *
 * The chat interface keeps the selected model variant ("reasoning effort") in
 * local state and mirrors it into the chat store per session. Switching
 * sessions runs two effects in sequence: a restore effect that loads the
 * target session's agent/model/variant from the store, and an agent-change
 * effect that applies the newly selected agent's default variant. The
 * agent-change effect must not fire for restore-driven agent changes, and the
 * variant validation must not run against the previous model's variant list.
 */

import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAgentModelSync } from "@/components/chat/use-agent-model-sync";
import type { Agent } from "@/lib/opencode/types";
import { useChatStore } from "@/stores/chat-store";

const primaryAgents = vi.hoisted((): Agent[] => {
  const makeAgent = (name: string): Agent => ({
    name,
    description: name,
    mode: "primary",
    native: false,
    hidden: false,
    topP: 1,
    temperature: 1,
    color: "#000000",
    permission: [],
    options: {},
  });
  return [makeAgent("code"), makeAgent("build")];
});

vi.mock("@/components/chat/agent-selector", () => ({
  useAgents: () => ({ primaryAgents }),
}));

vi.mock("@/hooks/use-settings", () => ({
  useModelAgentBindings: () => ({ bindings: {} }),
}));

const initialStoreState = useChatStore.getState();

interface SelectedModel {
  providerID: string;
  modelID: string;
}

interface HarnessProps {
  activeSessionId: string;
  variants?: string[];
}

function useHarness({ activeSessionId, variants = [] }: HarnessProps) {
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<SelectedModel | null>(
    null,
  );
  const [selectedVariant, setSelectedVariant] = useState<string | null>(null);
  const [availableVariants, setAvailableVariants] =
    useState<string[]>(variants);

  useAgentModelSync({
    activeWorkspaceId: "ws-a",
    activeSessionId,
    selectedAgent,
    setSelectedAgent,
    selectedModel,
    setSelectedModel,
    selectedVariant,
    availableVariants,
    setSelectedVariant,
  });

  return {
    selectedAgent,
    selectedVariant,
    setSelectedAgent,
    setAvailableVariants,
  };
}

function seedWorkspace(input: {
  sessionAgents?: Record<string, string>;
  sessionVariants?: Record<string, string>;
  activeSessionId?: string;
}) {
  useChatStore.setState({
    activeWorkspaceId: "ws-a",
    activeSessionId: input.activeSessionId ?? "sess-a",
    workspaceStates: {
      "ws-a": {
        sessions: {},
        sessionsLoaded: true,
        messages: {},
        optimisticMessageIds: {},
        sessionStatuses: {},
        permissions: [],
        questions: [],
        todos: {},
        sessionAgents: input.sessionAgents ?? {},
        sessionModels: {},
        sessionVariants: input.sessionVariants ?? {},
        lastViewedAt: {},
        pinnedSessionIds: new Set(),
        sessionNotes: {},
      },
    },
  });
}

function switchToSession(
  rerender: (props: HarnessProps) => void,
  sessionId: string,
) {
  act(() => {
    useChatStore.setState({ activeSessionId: sessionId });
  });
  rerender({ activeSessionId: sessionId });
}

describe("useAgentModelSync", () => {
  beforeEach(() => {
    useChatStore.setState(initialStoreState, true);
  });

  it("preserves a stored variant when switching to a session with a different agent", () => {
    seedWorkspace({
      sessionAgents: { "sess-a": "code", "sess-b": "build" },
      sessionVariants: { "sess-b": "max" },
    });

    const { result, rerender } = renderHook(
      (props: HarnessProps) => useHarness(props),
      { initialProps: { activeSessionId: "sess-a" } },
    );
    expect(result.current.selectedAgent).toBe("code");

    switchToSession(rerender, "sess-b");

    expect(result.current.selectedAgent).toBe("build");
    expect(result.current.selectedVariant).toBe("max");
    expect(useChatStore.getState().getSessionVariant("sess-b")).toBe("max");
  });

  it("does not clear a freshly restored variant while the previous model's variant list is still showing", () => {
    seedWorkspace({
      sessionAgents: { "sess-a": "code", "sess-b": "code" },
      sessionVariants: { "sess-b": "max" },
    });

    const { result, rerender } = renderHook(
      (props: HarnessProps) => useHarness(props),
      { initialProps: { activeSessionId: "sess-a", variants: ["high"] } },
    );

    switchToSession(rerender, "sess-b");

    expect(result.current.selectedVariant).toBe("max");

    act(() => {
      result.current.setAvailableVariants(["low", "max"]);
    });
    expect(result.current.selectedVariant).toBe("max");
  });

  it("clears the restored variant once the new model's variant list arrives without it", () => {
    seedWorkspace({
      sessionAgents: { "sess-a": "code", "sess-b": "code" },
      sessionVariants: { "sess-b": "max" },
    });

    const { result, rerender } = renderHook(
      (props: HarnessProps) => useHarness(props),
      { initialProps: { activeSessionId: "sess-a", variants: ["high"] } },
    );

    switchToSession(rerender, "sess-b");
    expect(result.current.selectedVariant).toBe("max");

    act(() => {
      result.current.setAvailableVariants(["low"]);
    });
    expect(result.current.selectedVariant).toBeNull();
  });

  it("still resets the variant when the user explicitly changes agents", () => {
    seedWorkspace({
      sessionAgents: { "sess-a": "code" },
      sessionVariants: { "sess-a": "max" },
    });

    const { result } = renderHook((props: HarnessProps) => useHarness(props), {
      initialProps: { activeSessionId: "sess-a" },
    });
    expect(result.current.selectedVariant).toBe("max");

    act(() => {
      result.current.setSelectedAgent("build");
    });

    expect(result.current.selectedVariant).toBeNull();
    expect(useChatStore.getState().getSessionVariant("sess-a")).toBeNull();
  });
});

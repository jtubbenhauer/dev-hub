import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const engineState = vi.hoisted(() => ({
  value: { engine: "opencode", isLoading: false },
}));
vi.mock("@/hooks/use-workspace-engine", () => ({
  useWorkspaceEngine: () => engineState.value,
}));

import { EmptyChat } from "@/components/chat/empty-chat";

describe("EmptyChat", () => {
  it("names OpenCode for OpenCode workspaces", () => {
    engineState.value = { engine: "opencode", isLoading: false };
    render(<EmptyChat onSend={vi.fn()} />);
    expect(
      screen.getByText("Ask OpenCode anything about your project"),
    ).toBeInTheDocument();
  });

  it("names OmO for omo workspaces", () => {
    engineState.value = { engine: "omo", isLoading: false };
    render(<EmptyChat onSend={vi.fn()} />);
    expect(
      screen.getByText("Ask OmO anything about your project"),
    ).toBeInTheDocument();
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CommandInput } from "@/components/command-runner/command-input";
import type { AutocompleteSuggestion } from "@/lib/commands/types";

const SUGGESTIONS: AutocompleteSuggestion[] = [
  { value: "echo hello", label: "echo hello", source: "history" },
];

function renderCommandInput() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const onRun = vi.fn();
  const renderInput = () => (
    <QueryClientProvider client={queryClient}>
      <CommandInput
        workspaceId="ws-1"
        isRunning={false}
        onRun={onRun}
        onKill={vi.fn()}
      />
    </QueryClientProvider>
  );
  const view = render(renderInput());
  return { onRun, rerender: () => view.rerender(renderInput()) };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("CommandInput", () => {
  it("survives re-renders before any suggestions have loaded", () => {
    // Given an input whose suggestion query has no data yet
    const { rerender } = renderCommandInput();

    // When the parent re-renders it (opening the drawer does this)
    rerender();

    // Then it still renders instead of looping into "Too many re-renders"
    expect(screen.getByPlaceholderText("Enter command…")).toBeInTheDocument();
  });

  it("shows suggestions for typed input and runs the chosen one", async () => {
    // Given the autocomplete endpoint knows a matching command
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ suggestions: SUGGESTIONS }), {
            status: 200,
          }),
      ),
    );
    const user = userEvent.setup();
    const { onRun } = renderCommandInput();
    const input = screen.getByPlaceholderText("Enter command…");

    // When the user types, takes the suggestion with Tab and presses Enter
    await user.type(input, "echo");
    expect(await screen.findByText("echo hello")).toBeInTheDocument();
    await user.keyboard("{Tab}");
    await user.keyboard("{Enter}");

    // Then the chosen command runs
    expect(onRun).toHaveBeenCalledWith("echo hello");
  });
});

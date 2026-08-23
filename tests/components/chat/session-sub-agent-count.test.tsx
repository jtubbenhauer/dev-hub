import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SessionSubAgentCountIndicator } from "@/components/chat/session-sub-agent-count";

describe("SessionSubAgentCountIndicator", () => {
  it("renders nothing when no sub-agents are running", () => {
    const { container } = render(
      <SessionSubAgentCountIndicator count={{ active: 0, waiting: 0 }} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("uses singular wording for a single sub-agent", () => {
    render(<SessionSubAgentCountIndicator count={{ active: 1, waiting: 0 }} />);

    expect(screen.getByTitle("1 sub-agent working")).toHaveTextContent("1");
  });

  it("sums active and waiting sub-agents", () => {
    render(<SessionSubAgentCountIndicator count={{ active: 2, waiting: 1 }} />);

    expect(
      screen.getByTitle("3 sub-agents working (1 waiting for input)"),
    ).toHaveTextContent("3");
  });

  it("counts sub-agents that are only waiting for input", () => {
    render(<SessionSubAgentCountIndicator count={{ active: 0, waiting: 2 }} />);

    expect(
      screen.getByTitle("2 sub-agents working (2 waiting for input)"),
    ).toHaveTextContent("2");
  });

  it("renders the aggregated sub-agent task progress", () => {
    render(
      <SessionSubAgentCountIndicator
        count={{ active: 3, waiting: 0, progress: { completed: 5, total: 24 } }}
      />,
    );

    const bar = screen.getByRole("progressbar", {
      name: "5 of 24 sub-agent tasks completed",
    });
    expect(bar).toHaveAttribute("value", "5");
    expect(bar).toHaveAttribute("max", "24");
    expect(bar).toHaveClass("accent-violet-500");
  });

  it("describes both the sub-agent count and its aggregated progress", () => {
    render(
      <SessionSubAgentCountIndicator
        count={{ active: 2, waiting: 1, progress: { completed: 4, total: 10 } }}
      />,
    );

    expect(
      screen.getByTitle(
        "3 sub-agents working (1 waiting for input) — 4 of 10 sub-agent tasks completed",
      ),
    ).toBeInTheDocument();
  });

  it("omits the progress bar when no sub-agent tasks are known", () => {
    render(
      <SessionSubAgentCountIndicator
        count={{ active: 2, waiting: 0, progress: { completed: 0, total: 0 } }}
      />,
    );

    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.getByTitle("2 sub-agents working")).toHaveTextContent("2");
  });
});

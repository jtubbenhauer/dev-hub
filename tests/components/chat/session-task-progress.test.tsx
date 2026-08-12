import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SessionTaskProgressIndicator } from "@/components/chat/session-task-progress";

const NOW = Date.UTC(2026, 7, 12, 12);

describe("SessionTaskProgressIndicator", () => {
  it("keeps progress colored at exactly 24 hours old", () => {
    render(
      <SessionTaskProgressIndicator
        progress={{ completed: 2, total: 3, updatedAt: NOW - 86_400_000 }}
        currentTime={NOW}
      />,
    );

    expect(screen.getByRole("progressbar")).toHaveClass("accent-sky-500");
    expect(screen.getByTitle("2 of 3 tasks completed")).toBeInTheDocument();
  });

  it("mutes progress older than 24 hours and shows its age", () => {
    render(
      <SessionTaskProgressIndicator
        progress={{
          completed: 2,
          total: 3,
          updatedAt: NOW - 2 * 86_400_000,
        }}
        currentTime={NOW}
      />,
    );

    expect(
      screen.getByRole("progressbar", {
        name: "2 of 3 tasks completed. Task status last updated 2 days ago",
      }),
    ).toHaveClass("accent-gray-400");
    expect(
      screen.getByTitle("Task status last updated 2 days ago"),
    ).not.toHaveClass("opacity-70");
  });
});

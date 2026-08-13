import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SessionTaskProgressIndicator } from "@/components/chat/session-task-progress";

const NOW = Date.UTC(2026, 7, 12, 12);

describe("SessionTaskProgressIndicator", () => {
  it("keeps progress colored at exactly one hour old", () => {
    render(
      <SessionTaskProgressIndicator
        progress={{ completed: 2, total: 3, updatedAt: NOW - 3_600_000 }}
        currentTime={NOW}
      />,
    );

    expect(screen.getByRole("progressbar")).toHaveClass("accent-sky-500");
    expect(screen.getByTitle("2 of 3 tasks completed")).toBeInTheDocument();
  });

  it("mutes progress older than one hour and shows its age", () => {
    render(
      <SessionTaskProgressIndicator
        progress={{
          completed: 2,
          total: 3,
          updatedAt: NOW - 2 * 3_600_000,
        }}
        currentTime={NOW}
      />,
    );

    expect(
      screen.getByRole("progressbar", {
        name: "2 of 3 tasks completed. Task status last updated 2 hours ago",
      }),
    ).toHaveClass("accent-gray-400");
    expect(
      screen.getByTitle("Task status last updated 2 hours ago"),
    ).not.toHaveClass("opacity-70");
  });

  it("keeps old progress colored while the session is active", () => {
    render(
      <SessionTaskProgressIndicator
        progress={{ completed: 2, total: 3, updatedAt: NOW - 2 * 3_600_000 }}
        currentTime={NOW}
        isSessionActive
      />,
    );

    expect(screen.getByRole("progressbar")).toHaveClass("accent-sky-500");
    expect(screen.getByTitle("2 of 3 tasks completed")).toBeInTheDocument();
  });

  it("hides inactive completed progress older than one hour", () => {
    const { container } = render(
      <SessionTaskProgressIndicator
        progress={{ completed: 3, total: 3, updatedAt: NOW - 2 * 3_600_000 }}
        currentTime={NOW}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("keeps active completed progress visible after one hour", () => {
    render(
      <SessionTaskProgressIndicator
        progress={{ completed: 3, total: 3, updatedAt: NOW - 2 * 3_600_000 }}
        currentTime={NOW}
        isSessionActive
      />,
    );

    expect(screen.getByRole("progressbar")).toHaveClass("accent-sky-500");
  });
});

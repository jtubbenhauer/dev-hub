import { cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SessionList } from "@/components/chat/session-list";
import type { Session } from "@/lib/opencode/types";

const renders = vi.hoisted(() => ({
  list: 0,
  rowsBySessionId: {} as Record<string, number>,
}));

// The header's New chat menu renders once per list render and the background
// indicator once per row render, so they count renders without changing them.
vi.mock("@/components/chat/new-chat-menu", () => ({
  NewChatMenu: ({ children }: { readonly children: ReactNode }) => {
    renders.list += 1;
    return children;
  },
  NewChatEngineMenuItems: () => null,
}));
vi.mock("@/components/chat/session-background-indicator", () => ({
  SessionBackgroundIndicator: ({
    sessionId,
  }: {
    readonly sessionId: string;
  }) => {
    renders.rowsBySessionId[sessionId] =
      (renders.rowsBySessionId[sessionId] ?? 0) + 1;
    return null;
  },
}));

function makeSession(id: string): Session {
  return {
    id,
    projectID: "project",
    directory: "/workspace",
    title: `Session ${id}`,
    version: "1",
    time: { created: 1, updated: 1 },
  };
}

function makeListProps() {
  return {
    mode: "workspace" as const,
    sessions: { a: makeSession("a"), b: makeSession("b"), c: makeSession("c") },
    activeSessionId: "a",
    sessionStatuses: {},
    lastViewedAt: {},
    onCreateSession: vi.fn(),
    onDeleteSession: vi.fn(),
    onSelectSession: vi.fn(),
    onPinSession: vi.fn(),
    onUnpinSession: vi.fn(),
    onClearSessionNote: vi.fn(),
  };
}

afterEach(() => {
  cleanup();
  renders.list = 0;
  renders.rowsBySessionId = {};
});

describe("SessionList re-renders", () => {
  it("skips rendering when its parent re-renders with the same props", () => {
    // Given
    const props = makeListProps();
    const { rerender } = render(<SessionList {...props} />);
    const listRendersBefore = renders.list;

    // When
    rerender(<SessionList {...props} />);

    // Then
    expect(renders.list).toBe(listRendersBefore);
  });

  it("re-renders only the row whose status changed", () => {
    // Given
    const props = makeListProps();
    const { rerender } = render(<SessionList {...props} />);

    // When
    rerender(
      <SessionList {...props} sessionStatuses={{ b: { type: "busy" } }} />,
    );

    // Then
    expect(renders.rowsBySessionId).toEqual({ a: 1, b: 2, c: 1 });
  });
});

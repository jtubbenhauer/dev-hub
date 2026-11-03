import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/layout/authenticated-layout", () => ({
  AuthenticatedLayout: ({ children }: { children: ReactNode }) => (
    <div data-testid="authenticated-layout">{children}</div>
  ),
}));
vi.mock("@/components/workbench/workbench-view", () => ({
  WorkbenchView: () => <div data-testid="workbench-view" />,
}));
vi.mock("@/components/chat/chat-file-dialog", () => ({
  ChatFileDialog: () => <div data-testid="chat-file-dialog" />,
}));

import WorkbenchPage from "@/app/workbench/page";

describe("workbench page", () => {
  it("loads the workbench next to the chat file dialog inside the authenticated layout", async () => {
    // When
    render(<WorkbenchPage />);

    // Then
    const layout = screen.getByTestId("authenticated-layout");
    expect(await screen.findByTestId("workbench-view")).toBeInTheDocument();
    expect(layout).toContainElement(screen.getByTestId("workbench-view"));
    expect(layout).toContainElement(screen.getByTestId("chat-file-dialog"));
  });
});

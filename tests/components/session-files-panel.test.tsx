import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SessionFilesPanel } from "@/components/chat/session-files-panel";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { MessageWithParts } from "@/lib/opencode/types";

const mockOpenFile = vi.fn().mockResolvedValue(undefined);

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => true,
}));

vi.mock("@/hooks/use-settings", () => ({
  useChatFileOpenSetting: () => ({
    fileOpenMode: "dialog",
    isLoading: false,
  }),
}));

vi.mock("@/stores/workspace-store", () => ({
  useWorkspaceStore: (
    selector: (state: { activeWorkspaceId: string }) => unknown,
  ) => selector({ activeWorkspaceId: "workspace-1" }),
}));

vi.mock("@/stores/chat-file-dialog-store", () => ({
  useChatFileDialogStore: Object.assign(vi.fn(), {
    getState: () => ({ openFile: mockOpenFile }),
  }),
}));

vi.mock("@/lib/side-panel-open-file", () => ({
  openFileInSidePanel: vi.fn(),
}));

function makeMessage(): MessageWithParts {
  return {
    info: {
      id: "message-1",
      sessionID: "session-1",
      role: "assistant",
      time: { created: 1 },
      parentID: "",
      modelID: "",
      providerID: "",
      mode: "",
      path: { cwd: "/workspace", root: "/workspace" },
      cost: 0,
      tokens: {
        input: 0,
        output: 0,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      },
    },
    parts: [
      {
        id: "part-1",
        sessionID: "session-1",
        messageID: "message-1",
        type: "tool",
        callID: "call-1",
        tool: "write",
        state: {
          status: "completed",
          input: { filePath: "/workspace/src/example.ts" },
          output: "",
          title: "",
          metadata: {},
          time: { start: 1, end: 2 },
        },
      },
    ],
  };
}

describe("SessionFilesPanel", () => {
  it("closes the mobile sheet before opening a file dialog", async () => {
    const onFileOpen = vi.fn();
    render(
      <TooltipProvider>
        <SessionFilesPanel
          messages={[makeMessage()]}
          workspacePath="/workspace"
          onFileOpen={onFileOpen}
        />
      </TooltipProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /src\/example[.]ts/ }));

    await waitFor(() => expect(mockOpenFile).toHaveBeenCalledOnce());
    expect(onFileOpen).toHaveBeenCalledOnce();
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import type { TerminalHandle } from "@/components/terminal/terminal-panel";

let capturedOnReady: ((handle: TerminalHandle) => void) | undefined;
let capturedShellCommand: string | null | undefined;
let capturedEnvOverrides: Record<string, string> | undefined;
let capturedSessionId: string | undefined;
let capturedAutoFocus: boolean | undefined;

vi.mock("@/components/terminal/terminal-panel", () => ({
  TerminalPanel: (props: {
    shellCommand: string | null;
    envOverrides?: Record<string, string>;
    sessionId?: string;
    fontFamily?: string;
    autoFocus?: boolean;
    onReady?: (handle: TerminalHandle) => void;
  }) => {
    capturedOnReady = props.onReady;
    capturedShellCommand = props.shellCommand;
    capturedEnvOverrides = props.envOverrides;
    capturedSessionId = props.sessionId;
    capturedAutoFocus = props.autoFocus;
    return <div data-testid="terminal-panel" />;
  },
}));

vi.mock("@/hooks/use-settings", () => ({
  useNvimAppNameSetting: () => ({ nvimAppName: "devhub", isLoading: false }),
  useTerminalScrollbackSetting: () => ({ scrollback: 5000, isLoading: false }),
  useTerminalFontSetting: () => ({
    terminalFont: "geist-mono" as const,
    isLoading: false,
  }),
  terminalFontFamily: (font: string) =>
    font === "ibm-plex-mono-nerd"
      ? "BlexMonoNerdFontMono, monospace"
      : "var(--font-geist-mono), monospace",
}));

let mockFetchResponses: Array<{ ok: boolean; json: () => Promise<unknown> }> =
  [];

function pushFetchResponse(ok: boolean, body: unknown) {
  mockFetchResponses.push({ ok, json: () => Promise.resolve(body) });
}

vi.stubGlobal(
  "fetch",
  vi.fn((_url: string, _init?: RequestInit) => {
    const response = mockFetchResponses.shift();
    if (!response)
      return Promise.reject(new Error("No mock fetch response queued"));
    return Promise.resolve(response);
  }),
);

import { NeovimReviewEditor } from "@/components/review/neovim-review-editor";

function makeFileContent(path = "src/foo.ts") {
  return { original: "old", current: "new", path, language: "typescript" };
}

describe("NeovimReviewEditor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchResponses = [];
    capturedOnReady = undefined;
    capturedShellCommand = undefined;
    capturedEnvOverrides = undefined;
    capturedSessionId = undefined;
    capturedAutoFocus = undefined;
  });

  describe("dependency check", () => {
    it("shows error when nvim is not installed", async () => {
      pushFetchResponse(true, { nvim: false });
      pushFetchResponse(true, {
        wsUrl: "ws://localhost:3001",
        cwd: "/home/test",
        shellCommand: null,
      });

      render(
        <NeovimReviewEditor
          fileContent={makeFileContent()}
          workspaceId="ws-1"
          isLoading={false}
        />,
      );

      await waitFor(() => {
        expect(
          screen.getByText(/neovim is not installed/i),
        ).toBeInTheDocument();
      });
    });

    it("shows spinner while deps are being checked", () => {
      // Never resolve the fetch — deps stay unchecked
      vi.mocked(fetch).mockReturnValueOnce(new Promise(() => {}));

      const { container } = render(
        <NeovimReviewEditor
          fileContent={makeFileContent()}
          workspaceId="ws-1"
          isLoading={false}
        />,
      );

      expect(container.querySelector(".animate-spin")).toBeInTheDocument();
    });
  });

  describe("terminal resolve", () => {
    it("passes resolved wsUrl and cwd to TerminalPanel", async () => {
      pushFetchResponse(true, { nvim: true });
      pushFetchResponse(true, {
        wsUrl: "ws://localhost:3001",
        cwd: "/home/test",
        shellCommand: null,
      });

      render(
        <NeovimReviewEditor
          fileContent={makeFileContent("src/bar.ts")}
          workspaceId="ws-1"
          isLoading={false}
        />,
      );

      await waitFor(() => {
        expect(screen.getByTestId("terminal-panel")).toBeInTheDocument();
      });

      expect(capturedShellCommand).toBe("nvim 'src/bar.ts'");
      expect(capturedSessionId).toBe("nvim-editor");
      expect(capturedAutoFocus).toBe(true);
    });

    it("shows error when resolve fails", async () => {
      pushFetchResponse(true, { nvim: true });
      pushFetchResponse(false, { error: "Workspace not found" });

      render(
        <NeovimReviewEditor
          fileContent={makeFileContent()}
          workspaceId="ws-bad"
          isLoading={false}
        />,
      );

      await waitFor(() => {
        expect(screen.getByText("Workspace not found")).toBeInTheDocument();
      });
    });
  });

  describe("file switching via PTY", () => {
    async function setupWithTerminal(filePath = "src/foo.ts") {
      pushFetchResponse(true, { nvim: true });
      pushFetchResponse(true, {
        wsUrl: "ws://localhost:3001",
        cwd: "/home/test",
        shellCommand: null,
      });

      const result = render(
        <NeovimReviewEditor
          fileContent={makeFileContent(filePath)}
          workspaceId="ws-1"
          isLoading={false}
        />,
      );

      await waitFor(() => {
        expect(screen.getByTestId("terminal-panel")).toBeInTheDocument();
      });

      return result;
    }

    it("sends :e command when handleTerminalReady fires", async () => {
      await setupWithTerminal("src/foo.ts");

      const mockHandle: TerminalHandle = {
        write: vi.fn(),
        focus: vi.fn(),
        blur: vi.fn(),
      };
      await act(() => capturedOnReady?.(mockHandle));

      // Escape key and :e command — may come from handleTerminalReady or the
      // file-switching effect depending on React's flush order, so wait for both.
      await vi.waitFor(() => {
        expect(mockHandle.write).toHaveBeenCalledWith("\x1b");
      });
      await vi.waitFor(() => {
        expect(mockHandle.write).toHaveBeenCalledWith(":e src/foo.ts\r");
      });
    });

    it("sends :e on file change via re-render", async () => {
      const { rerender } = await setupWithTerminal("src/foo.ts");

      const mockHandle: TerminalHandle = {
        write: vi.fn(),
        focus: vi.fn(),
        blur: vi.fn(),
      };
      act(() => capturedOnReady?.(mockHandle));

      // Wait for initial :e
      await vi.waitFor(() => {
        expect(mockHandle.write).toHaveBeenCalledWith(":e src/foo.ts\r");
      });

      vi.mocked(mockHandle.write).mockClear();

      // Re-render with a different file
      rerender(
        <NeovimReviewEditor
          fileContent={makeFileContent("src/bar.ts")}
          workspaceId="ws-1"
          isLoading={false}
        />,
      );

      expect(mockHandle.write).toHaveBeenCalledWith("\x1b");
      await vi.waitFor(() => {
        expect(mockHandle.write).toHaveBeenCalledWith(":e src/bar.ts\r");
      });
    });

    it("does not resend :e when file path is unchanged", async () => {
      const { rerender } = await setupWithTerminal("src/foo.ts");

      const mockHandle: TerminalHandle = {
        write: vi.fn(),
        focus: vi.fn(),
        blur: vi.fn(),
      };
      act(() => capturedOnReady?.(mockHandle));

      await vi.waitFor(() => {
        expect(mockHandle.write).toHaveBeenCalledWith(":e src/foo.ts\r");
      });

      vi.mocked(mockHandle.write).mockClear();

      // Re-render with same file
      rerender(
        <NeovimReviewEditor
          fileContent={makeFileContent("src/foo.ts")}
          workspaceId="ws-1"
          isLoading={false}
        />,
      );

      // No :e should be sent
      expect(mockHandle.write).not.toHaveBeenCalled();
    });

    it("catches up desired file if switch requested before handle ready", async () => {
      pushFetchResponse(true, { nvim: true });
      pushFetchResponse(true, {
        wsUrl: "ws://localhost:3001",
        cwd: "/home/test",
        shellCommand: null,
      });

      const { rerender } = render(
        <NeovimReviewEditor
          fileContent={makeFileContent("src/first.ts")}
          workspaceId="ws-1"
          isLoading={false}
        />,
      );

      await waitFor(() => {
        expect(screen.getByTestId("terminal-panel")).toBeInTheDocument();
      });

      // Change file before terminal is ready (no onReady called yet)
      rerender(
        <NeovimReviewEditor
          fileContent={makeFileContent("src/second.ts")}
          workspaceId="ws-1"
          isLoading={false}
        />,
      );

      // Now terminal becomes ready — should open second.ts, not first.ts
      const mockHandle: TerminalHandle = {
        write: vi.fn(),
        focus: vi.fn(),
        blur: vi.fn(),
      };
      act(() => capturedOnReady?.(mockHandle));

      expect(mockHandle.write).toHaveBeenCalledWith("\x1b");
      await vi.waitFor(() => {
        expect(mockHandle.write).toHaveBeenCalledWith(":e src/second.ts\r");
      });

      // Should NOT have sent :e for first.ts
      expect(mockHandle.write).not.toHaveBeenCalledWith(":e src/first.ts\r");
    });
  });

  describe("shell command construction", () => {
    it("escapes single quotes in file paths", async () => {
      pushFetchResponse(true, { nvim: true });
      pushFetchResponse(true, {
        wsUrl: "ws://localhost:3001",
        cwd: "/home/test",
        shellCommand: null,
      });

      render(
        <NeovimReviewEditor
          fileContent={makeFileContent("src/it's a file.ts")}
          workspaceId="ws-1"
          isLoading={false}
        />,
      );

      await waitFor(() => {
        expect(screen.getByTestId("terminal-panel")).toBeInTheDocument();
      });

      expect(capturedShellCommand).toBe("nvim 'src/it'\\''s a file.ts'");
    });
  });

  describe("NVIM_APPNAME env override", () => {
    it("passes NVIM_APPNAME=devhub by default", async () => {
      pushFetchResponse(true, { nvim: true });
      pushFetchResponse(true, {
        wsUrl: "ws://localhost:3001",
        cwd: "/home/test",
        shellCommand: null,
      });

      render(
        <NeovimReviewEditor
          fileContent={makeFileContent()}
          workspaceId="ws-1"
          isLoading={false}
        />,
      );

      await waitFor(() => {
        expect(screen.getByTestId("terminal-panel")).toBeInTheDocument();
      });

      expect(capturedEnvOverrides).toEqual({ NVIM_APPNAME: "devhub" });
    });
  });

  describe("toolbar", () => {
    it("renders the file name in the toolbar", async () => {
      pushFetchResponse(true, { nvim: true });
      pushFetchResponse(true, {
        wsUrl: "ws://localhost:3001",
        cwd: "/home/test",
        shellCommand: null,
      });

      render(
        <NeovimReviewEditor
          fileContent={makeFileContent("lib/deep/nested/component.tsx")}
          workspaceId="ws-1"
          isLoading={false}
        />,
      );

      await waitFor(() => {
        expect(screen.getByText("component.tsx")).toBeInTheDocument();
      });
    });
  });

  describe("loading state", () => {
    it("shows spinner when isLoading prop is true", () => {
      pushFetchResponse(true, { nvim: true });

      const { container } = render(
        <NeovimReviewEditor
          fileContent={makeFileContent()}
          workspaceId="ws-1"
          isLoading={true}
        />,
      );

      expect(container.querySelector(".animate-spin")).toBeInTheDocument();
    });
  });
});

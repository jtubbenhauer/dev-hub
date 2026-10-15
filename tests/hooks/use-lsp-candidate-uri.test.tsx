import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLspCandidateUri } from "@/hooks/use-lsp-candidate-uri";
import { useLspEnabledSetting } from "@/hooks/use-settings";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { Workspace } from "@/types";

vi.mock("@/hooks/use-settings", () => ({ useLspEnabledSetting: vi.fn() }));
const workspace: Workspace = {
  id: "ws",
  userId: "user",
  name: "Workspace",
  path: "/Workspace",
  type: "repo",
  backend: "local",
  parentRepoPath: null,
  packageManager: null,
  quickCommands: null,
  provider: null,
  opencodeUrl: null,
  agentUrl: null,
  providerMeta: null,
  shellCommand: null,
  sshTarget: null,
  sshPath: null,
  worktreeSymlinks: null,
  linkedTaskId: null,
  linkedTaskMeta: null,
  color: null,
  createdAt: new Date(0),
  lastAccessedAt: new Date(0),
};
const input = { workspaceId: "ws", filePath: "src/a.ts", isLspEligible: true };
beforeEach(() => {
  vi.mocked(useLspEnabledSetting).mockReturnValue({
    isLspEnabled: true,
    isLoading: false,
  });
  useWorkspaceStore.setState({
    activeWorkspaceId: "ws",
    workspaces: [workspace],
  });
});
afterEach(cleanup);

describe("useLspCandidateUri", () => {
  it("returns the encoded file URI when the active local file is eligible", () => {
    // Given / When
    const { result } = renderHook(() =>
      useLspCandidateUri({ ...input, filePath: "src/my file.ts" }),
    );
    // Then
    expect(result.current).toBe("file:///Workspace/src/my%20file.ts");
  });
  it("returns undefined when LSP is disabled", () => {
    // Given
    vi.mocked(useLspEnabledSetting).mockReturnValue({
      isLspEnabled: false,
      isLoading: false,
    });
    // When
    const { result } = renderHook(() => useLspCandidateUri(input));
    // Then
    expect(result.current).toBeUndefined();
  });
  it("returns undefined when the workspace is remote", () => {
    // Given
    useWorkspaceStore.setState({
      workspaces: [{ ...workspace, backend: "remote" }],
    });
    // When
    const { result } = renderHook(() => useLspCandidateUri(input));
    // Then
    expect(result.current).toBeUndefined();
  });
  it("returns undefined when the workspace is not active", () => {
    // Given
    useWorkspaceStore.setState({ activeWorkspaceId: "other" });
    // When
    const { result } = renderHook(() => useLspCandidateUri(input));
    // Then
    expect(result.current).toBeUndefined();
  });
  it.each([
    { filePath: "README.md" },
    { isLspEligible: false },
    { filePath: undefined },
    { workspaceId: undefined },
  ])("returns undefined when the document is excluded: %j", (override) => {
    // Given / When
    const { result } = renderHook(() =>
      useLspCandidateUri({ ...input, ...override }),
    );
    // Then
    expect(result.current).toBeUndefined();
  });
});

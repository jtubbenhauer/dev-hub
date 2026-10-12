import { useEffect } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as Monaco from "monaco-editor";
import { MonacoEditor } from "@/components/editor/monaco-editor";
import { createSessionFixture } from "./lsp-session-fixture";
import {
  restoreBuiltinTypeScriptFeatures,
  trackBuiltinTs,
} from "@/lib/lsp/client/builtin-typescript";
import { useLspStore } from "@/stores/lsp-store";
import { createLspSessionController } from "@/lib/lsp/client/session-controller";

const state = vi.hoisted(() => ({
  isLspEnabled: true,
  isLoading: false,
  backend: "local",
  fixture: undefined as ReturnType<typeof createSessionFixture> | undefined,
  requestWorker: vi.fn(),
  createModel: vi.fn(),
}));

vi.mock("next/dynamic", () => ({
  default: () =>
    function Editor({
      beforeMount,
    }: {
      beforeMount: (monaco: typeof Monaco) => void;
    }) {
      useEffect(() => {
        const fixture = state.fixture;
        if (!fixture) throw new Error("Missing fixture");
        beforeMount(fixture.monaco);
        state.createModel();
        fixture.languages.registerInlayHintsProvider("typescript", {});
        if (fixture.registrations.size > 0) state.requestWorker();
      }, [beforeMount]);
      return null;
    },
}));
vi.mock("@/hooks/use-settings", () => ({
  useFontSizeSetting: () => ({ fontSize: 14 }),
  useMobileFontSizeSetting: () => ({ mobileFontSize: 12 }),
  useTabSizeSetting: () => ({ tabSize: 2 }),
  useLspEnabledSetting: () => ({
    isLspEnabled: state.isLspEnabled,
    isLoading: state.isLoading,
  }),
  useCodeLensSetting: () => ({ isCodeLensEnabled: false, isLoading: false }),
  useMinimapSetting: () => ({ isMinimapEnabled: true, isLoading: false }),
}));
vi.mock("@/stores/workspace-store", () => ({
  useWorkspaceStore: (
    selector: (value: {
      activeWorkspaceId: string;
      workspaces: { id: string; backend: string }[];
    }) => unknown,
  ) =>
    selector({
      activeWorkspaceId: "ws",
      workspaces: [{ id: "ws", backend: state.backend }],
    }),
}));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@/components/providers/theme-provider", () => ({
  useTheme: () => ({ theme: "system", resolvedMode: "dark" }),
}));
vi.mock("@/hooks/use-file-comments", () => ({
  useFileComments: () => ({ data: [] }),
  useCreateFileComment: () => ({ mutate: vi.fn() }),
  useResolveFileComment: () => ({ mutate: vi.fn() }),
  useDeleteFileComment: () => ({ mutate: vi.fn() }),
  useUpdateFileComment: () => ({ mutate: vi.fn() }),
}));
vi.mock("@/lib/editor/monaco-themes", () => ({
  MONACO_FONT_FAMILY: "monospace",
  registerMonacoThemes: vi.fn(),
  getMonacoThemeName: () => "test",
}));
vi.mock("@/hooks/use-monaco-diagnostic-markers", () => ({
  useMonacoDiagnosticMarkers: vi.fn(),
}));
vi.mock("@/hooks/use-lsp-editor-attachment", () => ({
  useLspEditorAttachment: () => undefined,
}));

beforeEach(() => {
  vi.clearAllMocks();
  state.fixture = createSessionFixture();
  state.isLspEnabled = true;
  state.isLoading = false;
  state.backend = "local";
  useLspStore.setState({ status: "starting", retryNonce: 0 });
});
afterEach(cleanup);

function editor(isLspEligible = true) {
  return (
    <MonacoEditor
      content="const value = 1"
      language="typescript"
      onChange={vi.fn()}
      workspaceId="ws"
      filePath="src/a.ts"
      isLspEligible={isLspEligible}
    />
  );
}

describe("built-in TS startup gate", () => {
  it("holds existing and lazily registered providers before the first model while starting", () => {
    // Given
    const fixture = state.fixture;
    if (!fixture) throw new Error("Missing fixture");
    trackBuiltinTs(fixture.monaco);
    fixture.languages.registerHoverProvider("typescript", {});
    // When
    render(editor());
    fixture.languages.registerHoverProvider("javascript", {});
    // Then
    expect(state.createModel).toHaveBeenCalledOnce();
    expect(state.requestWorker).not.toHaveBeenCalled();
    expect(fixture.registrations.size).toBe(0);
  });

  it("waits for the initial setting before permitting a model", () => {
    // Given
    state.isLoading = true;
    state.isLspEnabled = false;
    const view = render(editor());
    expect(state.createModel).not.toHaveBeenCalled();
    // When
    state.isLoading = false;
    state.isLspEnabled = true;
    view.rerender(editor());
    // Then
    expect(state.createModel).toHaveBeenCalledOnce();
    expect(state.requestWorker).not.toHaveBeenCalled();
  });

  it("suppresses an existing OFF editor before enable-triggered passive provider work", () => {
    state.isLspEnabled = false;
    const view = render(editor());
    state.requestWorker.mockClear();
    state.isLspEnabled = true;
    view.rerender(editor());
    expect(state.requestWorker).not.toHaveBeenCalled();
    expect(state.fixture?.registrations.size).toBe(0);
  });

  it.each(["error", "busy"] as const)(
    "does not suppress a new editor after terminal %s",
    (status) => {
      useLspStore.getState().setStatus(status);
      render(editor());
      expect(state.requestWorker).toHaveBeenCalledOnce();
    },
  );

  it.each(["disabled", "remote", "ineligible"])(
    "keeps built-ins for %s surfaces",
    (mode) => {
      // Given
      state.isLspEnabled = mode !== "disabled";
      state.backend = mode === "remote" ? "remote" : "local";
      // When
      render(editor(mode !== "ineligible"));
      // Then
      expect(state.requestWorker).toHaveBeenCalledOnce();
    },
  );

  it.each(["failure", "disable"])(
    "restores held providers on controller %s",
    async (mode) => {
      // Given
      render(editor());
      const fixture = state.fixture;
      if (!fixture) throw new Error("Missing fixture");
      expect(fixture.registrations.size).toBe(0);
      const restored = Promise.withResolvers<void>();
      const controller = createLspSessionController({
        fetchImpl: async () => new Response("{}", { status: 500 }),
        connect: vi.fn(),
        restoreBuiltin: () => {
          restoreBuiltinTypeScriptFeatures(fixture.monaco);
          restored.resolve();
        },
      });
      // When
      await act(async () => {
        controller.update({
          isLspEnabled: mode !== "disable",
          isMonacoRegistered: true,
          hasAttachedEditor: true,
          workspace: { id: "ws", path: "/Workspace", backend: "local" },
          retryNonce: 0,
        });
        await restored.promise;
      });
      // Then
      expect(fixture.registrations.size).toBeGreaterThan(0);
      controller.dispose();
    },
  );
});

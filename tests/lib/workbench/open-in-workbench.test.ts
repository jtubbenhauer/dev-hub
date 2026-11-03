import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BINARY_FILE_LANGUAGE,
  IMAGE_LANGUAGE,
  PDF_LANGUAGE,
} from "@/lib/file-preview";
import {
  isPendingNavigationCurrent,
  setPendingNavigation,
} from "@/lib/lsp/client/navigation-registry";
import {
  focusRecentInWorkbench,
  isWorkbenchPathname,
  openChatInWorkbench,
  openDiffInWorkbench,
  openFileInWorkbench,
  openNewChatInWorkbench,
  openTerminalInWorkbench,
} from "@/lib/workbench/open-in-workbench";
import {
  registerWorkbenchController,
  type WorkbenchController,
} from "@/lib/workbench/workbench-controller-registry";
import type { WorkbenchTabParams } from "@/lib/workbench/tab-descriptors";
import {
  createWorkbenchHref,
  WORKBENCH_PATH,
} from "@/lib/workbench/workbench-href";
import { useChatStore } from "@/stores/chat-store";
import { useEditorStore } from "@/stores/editor-store";
import { useWorkbenchStore } from "@/stores/workbench-store";
import { useWorkspaceStore } from "@/stores/workspace-store";

vi.mock("sonner", () => ({ toast: { warning: vi.fn() } }));

const WORKSPACE_ID = "ws-1";
const OTHER_WORKSPACE_ID = "ws-2";

function createFakeController(
  workspaceId: string,
  focusMostRecentResult = false,
) {
  return {
    workspaceId,
    openTab: vi.fn((_params: WorkbenchTabParams) => "tab-opened"),
    openNewTerminal: vi.fn(() => "tab-terminal"),
    openNewChat: vi.fn(() => "tab-chat"),
    closeTabs: vi.fn(
      (_predicate: (params: WorkbenchTabParams) => boolean) => {},
    ),
    focusMostRecent: vi.fn(
      (_kind: "chat" | "file" | "terminal") => focusMostRecentResult,
    ),
    openContextSidebar: vi.fn(),
    revealFolder: vi.fn(),
    runCommand: vi.fn(),
  } satisfies WorkbenchController;
}

const cleanups: (() => void)[] = [];
function register<Controller extends WorkbenchController>(
  controller: Controller,
) {
  cleanups.push(registerWorkbenchController(controller));
  return controller;
}

function requestRevealFor(path: string) {
  useEditorStore.getState().requestReveal({
    workspaceId: WORKSPACE_ID,
    path,
    lineNumber: 3,
    startColumn: 1,
    endColumn: 4,
    startByteColumn: 1,
    lineSha256: "sha",
  });
}

const diskResponse = () =>
  Response.json({ content: "disk", language: "typescript" });

beforeEach(() => {
  useEditorStore.getState().closeAllFiles();
  useEditorStore.setState({ pendingReveal: null });
  useWorkbenchStore.setState(useWorkbenchStore.getInitialState(), true);
  useWorkspaceStore.setState({ activeWorkspaceId: null });
  useChatStore.setState({ activeWorkspaceId: null, activeSessionId: null });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => diskResponse()),
  );
});

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.unstubAllGlobals();
});

describe("openFileInWorkbench", () => {
  const fileInput = {
    workspaceId: WORKSPACE_ID,
    path: "src/a.ts",
    isFileTabsDisabled: false,
  };

  it("navigates to the file intent when no controller is registered", async () => {
    const navigate = vi.fn();

    expect(await openFileInWorkbench({ ...fileInput, navigate })).toBe(true);

    expect(navigate).toHaveBeenCalledExactlyOnceWith(
      createWorkbenchHref({
        open: "file",
        workspaceId: WORKSPACE_ID,
        path: "src/a.ts",
      }),
    );
  });

  it("navigates when the controller belongs to another workspace", async () => {
    const controller = register(createFakeController(OTHER_WORKSPACE_ID));
    const navigate = vi.fn();

    expect(await openFileInWorkbench({ ...fileInput, navigate })).toBe(true);

    expect(navigate).toHaveBeenCalledExactlyOnceWith(
      createWorkbenchHref({
        open: "file",
        workspaceId: WORKSPACE_ID,
        path: "src/a.ts",
      }),
    );
    expect(controller.openTab).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("loads the buffer and opens one file tab when direct", async () => {
    const controller = register(createFakeController(WORKSPACE_ID));
    const navigate = vi.fn();

    expect(await openFileInWorkbench({ ...fileInput, navigate })).toBe(true);

    expect(controller.openTab).toHaveBeenCalledExactlyOnceWith({
      kind: "file",
      workspaceId: WORKSPACE_ID,
      path: "src/a.ts",
    });
    expect(useEditorStore.getState().openFiles).toEqual([
      expect.objectContaining({ path: "src/a.ts", content: "disk" }),
    ]);
    expect(controller.closeTabs).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("closes other file tabs through the predicate when file tabs are disabled", async () => {
    const controller = register(createFakeController(WORKSPACE_ID));

    await openFileInWorkbench({
      ...fileInput,
      isFileTabsDisabled: true,
      navigate: vi.fn(),
    });

    expect(controller.closeTabs).toHaveBeenCalledOnce();
    const predicate = controller.closeTabs.mock.calls[0][0];
    expect(
      predicate({ kind: "file", workspaceId: WORKSPACE_ID, path: "src/b.ts" }),
    ).toBe(true);
    expect(
      predicate({ kind: "file", workspaceId: WORKSPACE_ID, path: "src/a.ts" }),
    ).toBe(false);
    expect(
      predicate({ kind: "chat", workspaceId: WORKSPACE_ID, sessionId: "s" }),
    ).toBe(false);
    expect(controller.openTab).toHaveBeenCalledOnce();
  });

  it("clears the matching pending reveal and returns false when the load fails", async () => {
    const controller = register(createFakeController(WORKSPACE_ID));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 404 })),
    );
    requestRevealFor("src/a.ts");

    expect(await openFileInWorkbench({ ...fileInput, navigate: vi.fn() })).toBe(
      false,
    );

    expect(useEditorStore.getState().pendingReveal).toBeNull();
    expect(controller.openTab).not.toHaveBeenCalled();
  });

  it("keeps a pending reveal for another path when the load fails", async () => {
    register(createFakeController(WORKSPACE_ID));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 404 })),
    );
    requestRevealFor("src/other.ts");

    await openFileInWorkbench({ ...fileInput, navigate: vi.fn() });

    expect(useEditorStore.getState().pendingReveal?.path).toBe("src/other.ts");
  });

  it("opens no tab when shouldCommit is false", async () => {
    const controller = register(createFakeController(WORKSPACE_ID));

    expect(
      await openFileInWorkbench({
        ...fileInput,
        shouldCommit: () => false,
        navigate: vi.fn(),
      }),
    ).toBe(false);

    expect(controller.openTab).not.toHaveBeenCalled();
  });

  it("opens no tab when the open is superseded after the buffer loaded", async () => {
    const controller = register(createFakeController(WORKSPACE_ID));
    let commitChecks = 0;
    const shouldCommit = () => {
      commitChecks += 1;
      return commitChecks === 1;
    };

    expect(
      await openFileInWorkbench({
        ...fileInput,
        isFileTabsDisabled: true,
        shouldCommit,
        navigate: vi.fn(),
      }),
    ).toBe(false);

    expect(useEditorStore.getState().openFiles).toHaveLength(1);
    expect(controller.closeTabs).not.toHaveBeenCalled();
    expect(controller.openTab).not.toHaveBeenCalled();
  });

  it("returns false without navigating when the file cannot be read", async () => {
    // Given
    const controller = register(createFakeController(WORKSPACE_ID));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 404 })),
    );
    const navigate = vi.fn();

    // When
    const result = await openFileInWorkbench({ ...fileInput, navigate });

    // Then
    expect(result).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
    expect(controller.openTab).not.toHaveBeenCalled();
    expect(useEditorStore.getState().openFiles).toEqual([]);
  });

  it.each([
    { kind: "a PDF", path: "docs/spec.pdf", language: PDF_LANGUAGE },
    {
      kind: "an image",
      path: "assets/screenshot.jpg",
      language: IMAGE_LANGUAGE,
    },
  ])(
    "opens $kind as a preview tab without reading its text",
    async ({ path, language }) => {
      // Given
      const controller = register(createFakeController(WORKSPACE_ID));

      // When
      const result = await openFileInWorkbench({
        ...fileInput,
        path,
        navigate: vi.fn(),
      });

      // Then
      expect(result).toBe(true);
      expect(fetch).not.toHaveBeenCalled();
      expect(controller.openTab).toHaveBeenCalledExactlyOnceWith({
        kind: "file",
        workspaceId: WORKSPACE_ID,
        path,
      });
      expect(useEditorStore.getState().openFiles).toEqual([
        expect.objectContaining({ path, language }),
      ]);
    },
  );

  it("opens a file the editor refuses as a download tab", async () => {
    // Given
    const controller = register(createFakeController(WORKSPACE_ID));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ error: "binary" }, { status: 415 })),
    );

    // When
    const result = await openFileInWorkbench({
      ...fileInput,
      path: "build/app.zip",
      navigate: vi.fn(),
    });

    // Then
    expect(result).toBe(true);
    expect(controller.openTab).toHaveBeenCalledExactlyOnceWith({
      kind: "file",
      workspaceId: WORKSPACE_ID,
      path: "build/app.zip",
    });
    expect(useEditorStore.getState().openFiles).toEqual([
      expect.objectContaining({
        path: "build/app.zip",
        language: BINARY_FILE_LANGUAGE,
      }),
    ]);
  });

  it("never opens a navigation that a later one superseded and outran", async () => {
    // Given
    const controller = register(createFakeController(WORKSPACE_ID));
    let finishA: (response: Response) => void = () => {};
    let finishB: (response: Response) => void = () => {};
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise<Response>((resolve) => {
              finishA = resolve;
            }),
        )
        .mockImplementationOnce(
          () =>
            new Promise<Response>((resolve) => {
              finishB = resolve;
            }),
        ),
    );
    const target = { lineNumber: 1, column: 1 };
    const tokenA = setPendingNavigation("files-page", {
      ...target,
      uriKey: "a",
    });
    const openA = openFileInWorkbench({
      ...fileInput,
      path: "a.ts",
      shouldCommit: () => isPendingNavigationCurrent("files-page", tokenA),
      navigate: vi.fn(),
    });
    const tokenB = setPendingNavigation("files-page", {
      ...target,
      uriKey: "b",
    });
    const openB = openFileInWorkbench({
      ...fileInput,
      path: "b.ts",
      shouldCommit: () => isPendingNavigationCurrent("files-page", tokenB),
      navigate: vi.fn(),
    });

    // When
    finishB(diskResponse());
    await openB;
    finishA(diskResponse());
    const resultA = await openA;

    // Then
    expect(resultA).toBe(false);
    expect(controller.openTab).toHaveBeenCalledExactlyOnceWith({
      kind: "file",
      workspaceId: WORKSPACE_ID,
      path: "b.ts",
    });
    expect(
      useEditorStore.getState().openFiles.map((file) => file.path),
    ).toEqual(["b.ts"]);
  });
});

describe("openChatInWorkbench", () => {
  it("sets both active ids and queues the chat target when direct", () => {
    register(createFakeController(WORKSPACE_ID));
    const navigate = vi.fn();

    openChatInWorkbench({
      workspaceId: WORKSPACE_ID,
      sessionId: "session-1",
      navigate,
    });

    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe(WORKSPACE_ID);
    expect(useChatStore.getState().activeWorkspaceId).toBe(WORKSPACE_ID);
    expect(useChatStore.getState().activeSessionId).toBe("session-1");
    expect(useWorkbenchStore.getState().pendingChatTarget).toEqual({
      workspaceId: WORKSPACE_ID,
      sessionId: "session-1",
      panelId: null,
    });
    expect(navigate).not.toHaveBeenCalled();
  });

  it("sets both active ids, navigates and queues nothing when not direct", () => {
    register(createFakeController(OTHER_WORKSPACE_ID));
    const navigate = vi.fn();

    openChatInWorkbench({
      workspaceId: WORKSPACE_ID,
      sessionId: "session-1",
      navigate,
    });

    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe(WORKSPACE_ID);
    expect(useChatStore.getState().activeSessionId).toBe("session-1");
    expect(useWorkbenchStore.getState().pendingChatTarget).toBeNull();
    expect(navigate).toHaveBeenCalledExactlyOnceWith(
      createWorkbenchHref({
        open: "chat",
        workspaceId: WORKSPACE_ID,
        sessionId: "session-1",
      }),
    );
  });

  it("focuses the most recent chat tab for a null session when direct", () => {
    const controller = register(createFakeController(WORKSPACE_ID, true));

    openChatInWorkbench({
      workspaceId: WORKSPACE_ID,
      sessionId: null,
      navigate: vi.fn(),
    });

    expect(controller.focusMostRecent).toHaveBeenCalledExactlyOnceWith("chat");
    expect(controller.openNewChat).not.toHaveBeenCalled();
    expect(useWorkbenchStore.getState().pendingChatTarget).toBeNull();
  });

  it("opens a new chat for a null session when no chat tab can be focused", () => {
    const controller = register(createFakeController(WORKSPACE_ID, false));

    openChatInWorkbench({
      workspaceId: WORKSPACE_ID,
      sessionId: null,
      navigate: vi.fn(),
    });

    expect(controller.openNewChat).toHaveBeenCalledOnce();
  });

  it("navigates with the null-session chat intent when not direct", () => {
    const navigate = vi.fn();

    openChatInWorkbench({
      workspaceId: WORKSPACE_ID,
      sessionId: null,
      navigate,
    });

    expect(navigate).toHaveBeenCalledExactlyOnceWith(
      createWorkbenchHref({
        open: "chat",
        workspaceId: WORKSPACE_ID,
        sessionId: null,
      }),
    );
    expect(useChatStore.getState().activeSessionId).toBeNull();
  });
});

describe("openNewChatInWorkbench", () => {
  it("always opens a new chat tab when direct", () => {
    const controller = register(createFakeController(WORKSPACE_ID, true));
    const navigate = vi.fn();

    openNewChatInWorkbench({ workspaceId: WORKSPACE_ID, navigate });

    expect(controller.openNewChat).toHaveBeenCalledOnce();
    expect(controller.focusMostRecent).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("navigates to the new-chat intent when not direct", () => {
    register(createFakeController(OTHER_WORKSPACE_ID));
    const navigate = vi.fn();

    openNewChatInWorkbench({ workspaceId: WORKSPACE_ID, navigate });

    expect(navigate).toHaveBeenCalledExactlyOnceWith(
      createWorkbenchHref({ open: "new-chat", workspaceId: WORKSPACE_ID }),
    );
  });
});

describe("openTerminalInWorkbench", () => {
  it("opens a new terminal tab when direct", () => {
    const controller = register(createFakeController(WORKSPACE_ID));
    const navigate = vi.fn();

    openTerminalInWorkbench({ workspaceId: WORKSPACE_ID, navigate });

    expect(controller.openNewTerminal).toHaveBeenCalledOnce();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("navigates to the terminal intent when not direct", () => {
    const navigate = vi.fn();

    openTerminalInWorkbench({ workspaceId: WORKSPACE_ID, navigate });

    expect(navigate).toHaveBeenCalledExactlyOnceWith(
      createWorkbenchHref({ open: "terminal", workspaceId: WORKSPACE_ID }),
    );
  });
});

describe("openDiffInWorkbench", () => {
  const diffInput = {
    workspaceId: WORKSPACE_ID,
    path: "src/a.ts",
    source: "compare",
    baseRef: "main",
  } as const;

  it("opens a diff tab and returns true when direct", () => {
    const controller = register(createFakeController(WORKSPACE_ID));

    expect(openDiffInWorkbench(diffInput)).toBe(true);

    expect(controller.openTab).toHaveBeenCalledExactlyOnceWith({
      kind: "diff",
      workspaceId: WORKSPACE_ID,
      path: "src/a.ts",
      source: "compare",
      baseRef: "main",
    });
  });

  it("returns false when the controller belongs to another workspace", () => {
    const controller = register(createFakeController(OTHER_WORKSPACE_ID));

    expect(openDiffInWorkbench(diffInput)).toBe(false);

    expect(controller.openTab).not.toHaveBeenCalled();
  });

  it("returns false when no controller is registered", () => {
    expect(openDiffInWorkbench(diffInput)).toBe(false);
  });
});

describe("focusRecentInWorkbench", () => {
  it.each(["chat", "file", "terminal"] as const)(
    "focuses the most recent %s tab when one exists",
    (kind) => {
      const controller = register(createFakeController(WORKSPACE_ID, true));

      focusRecentInWorkbench({ kind, navigate: vi.fn() });

      expect(controller.focusMostRecent).toHaveBeenCalledExactlyOnceWith(kind);
      expect(controller.openNewChat).not.toHaveBeenCalled();
      expect(controller.openNewTerminal).not.toHaveBeenCalled();
      expect(controller.openContextSidebar).not.toHaveBeenCalled();
    },
  );

  it("opens a new chat when no chat tab can be focused", () => {
    const controller = register(createFakeController(WORKSPACE_ID));

    focusRecentInWorkbench({ kind: "chat", navigate: vi.fn() });

    expect(controller.openNewChat).toHaveBeenCalledOnce();
    expect(controller.openNewTerminal).not.toHaveBeenCalled();
  });

  it("opens a new terminal when no terminal tab can be focused", () => {
    const controller = register(createFakeController(WORKSPACE_ID));

    focusRecentInWorkbench({ kind: "terminal", navigate: vi.fn() });

    expect(controller.openNewTerminal).toHaveBeenCalledOnce();
    expect(controller.openNewChat).not.toHaveBeenCalled();
  });

  it("opens the explorer when no file tab can be focused", () => {
    const controller = register(createFakeController(WORKSPACE_ID));

    focusRecentInWorkbench({ kind: "file", navigate: vi.fn() });

    expect(controller.openContextSidebar).toHaveBeenCalledExactlyOnceWith(
      "explorer",
    );
  });

  it.each([
    [
      "chat",
      createWorkbenchHref({ open: "chat", workspaceId: null, sessionId: null }),
    ],
    ["terminal", createWorkbenchHref({ open: "terminal", workspaceId: null })],
    ["file", createWorkbenchHref({ open: "explorer", workspaceId: null })],
  ] as const)(
    "navigates to the %s intent without a workspace when no controller is registered",
    (kind, expectedHref) => {
      const navigate = vi.fn();

      focusRecentInWorkbench({ kind, navigate });

      expect(navigate).toHaveBeenCalledExactlyOnceWith(expectedHref);
    },
  );
});

describe("isWorkbenchPathname", () => {
  it("is true for the workbench path", () => {
    expect(isWorkbenchPathname(WORKBENCH_PATH)).toBe(true);
  });

  it.each(["/chat", "/files", `${WORKBENCH_PATH}/x`, ""])(
    "is false for %s",
    (pathname) => {
      expect(isWorkbenchPathname(pathname)).toBe(false);
    },
  );
});

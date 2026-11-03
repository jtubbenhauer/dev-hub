import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  DockviewReact,
  type DockviewApi,
  type IDockviewPanelProps,
} from "dockview-react";

import { createWorkbenchDockviewController } from "@/components/workbench/workbench-dockview-controller";
import { LauncherPanel } from "@/components/workbench/workbench-launcher";
import { WorkbenchPanelFrame } from "@/components/workbench/workbench-panel-frame";
import type { WorkbenchTabParams } from "@/lib/workbench/tab-descriptors";
import {
  registerWorkbenchController,
  type WorkbenchController,
} from "@/lib/workbench/workbench-controller-registry";
import type { WorkbenchLayoutApi } from "@/lib/workbench/workbench-layout-api";
import { useWorkbenchStore } from "@/stores/workbench-store";

import { createActDockviewLayoutApi } from "./probe-dockview";

vi.mock("@/components/file-picker/file-picker", () => ({
  useFilePicker: () => ({
    isOpen: false,
    open: vi.fn(),
    close: vi.fn(),
    toggle: vi.fn(),
  }),
}));

const WORKSPACE_ID = "ws-1";
const LEFT_TAB = "tab-left";
const RIGHT_TAB = "tab-right";

// A tab body that names no focus target of its own.
function TextInputPanel({ api }: IDockviewPanelProps<WorkbenchTabParams>) {
  return (
    <WorkbenchPanelFrame api={api}>
      <textarea aria-label={`${api.id} input`} />
    </WorkbenchPanelFrame>
  );
}

const PANEL_COMPONENTS = {
  terminal: TextInputPanel,
  file: TextInputPanel,
  chat: TextInputPanel,
  diff: TextInputPanel,
  launcher: LauncherPanel,
};

interface FramedWorkbench {
  readonly layoutApi: WorkbenchLayoutApi;
  readonly controller: WorkbenchController;
}

const unregisterControllers: (() => void)[] = [];

function renderFramedWorkbench(): FramedWorkbench {
  const readyApis: DockviewApi[] = [];
  render(
    <div style={{ width: 800, height: 600 }}>
      <DockviewReact
        components={PANEL_COMPONENTS}
        defaultRenderer="always"
        onReady={(event) => readyApis.push(event.api)}
      />
    </div>,
  );
  const [api] = readyApis;
  if (!api) throw new Error("DockviewReact never fired onReady");
  const layoutApi = createActDockviewLayoutApi(api);
  const controller = createWorkbenchDockviewController({
    layoutApi,
    workspaceId: WORKSPACE_ID,
    endTerminalSession: vi.fn(),
    isMobile: false,
  });
  unregisterControllers.push(registerWorkbenchController(controller));
  return { layoutApi, controller };
}

function chatTabParams(sessionId: string): WorkbenchTabParams {
  return { kind: "chat", workspaceId: WORKSPACE_ID, sessionId };
}

// One chat tab whose text input holds the DOM focus.
function renderFocusedChatTab(): FramedWorkbench {
  const workbench = renderFramedWorkbench();
  workbench.layoutApi.addPanel({
    id: LEFT_TAB,
    params: chatTabParams("s1"),
    title: LEFT_TAB,
    groupId: null,
  });
  screen.getByLabelText(`${LEFT_TAB} input`).focus();
  return workbench;
}

// Two groups side by side; the right tab is active and holds the DOM focus.
function renderTwoGroups(): FramedWorkbench {
  const workbench = renderFocusedChatTab();
  const leftGroupId = workbench.layoutApi.getPanel(LEFT_TAB)?.groupId;
  if (!leftGroupId) throw new Error("the left tab has no group");
  workbench.layoutApi.addGroupWithPanel({
    referenceGroupId: leftGroupId,
    direction: "right",
    panel: { id: RIGHT_TAB, params: chatTabParams("s2"), title: RIGHT_TAB },
  });
  workbench.layoutApi.activatePanel(RIGHT_TAB);
  screen.getByLabelText(`${RIGHT_TAB} input`).focus();
  return workbench;
}

beforeEach(() => {
  useWorkbenchStore.setState(useWorkbenchStore.getInitialState(), true);
});

afterEach(() => {
  cleanup();
  for (const unregister of unregisterControllers.splice(0)) unregister();
});

describe("WorkbenchPanelFrame keyboard focus", () => {
  it("takes the keyboard focus out of the previous group for a tab without a focus target", () => {
    // Given
    const { controller } = renderTwoGroups();

    // When
    act(() =>
      controller.runCommand({ type: "focus-group", direction: "left" }),
    );

    // Then
    expect(document.activeElement).toBe(
      screen.getByLabelText(`${LEFT_TAB} input`).parentElement,
    );
  });

  it("focuses the launcher of a keyboard split", () => {
    // Given
    const { controller } = renderFocusedChatTab();

    // When
    act(() => controller.runCommand({ type: "split", direction: "right" }));

    // Then
    expect(document.activeElement).toBe(
      screen.getByRole("group", { name: "New tab" }),
    );
  });

  it("opens a terminal in the split's group from its launcher key without a click", async () => {
    // Given
    const { layoutApi, controller } = renderFocusedChatTab();
    act(() => controller.runCommand({ type: "split", direction: "right" }));
    const launcherGroupId = layoutApi.getPanel(
      layoutApi.getActivePanelId() ?? "",
    )?.groupId;

    // When
    await userEvent.keyboard("t");

    // Then
    const terminalGroupIds = layoutApi
      .getPanels()
      .filter((panel) => panel.params.kind === "terminal")
      .map((panel) => panel.groupId);
    expect(terminalGroupIds).toEqual([launcherGroupId]);
  });

  it("makes no keyboard focus request when a pointer activates a tab", () => {
    // Given
    const { layoutApi } = renderTwoGroups();

    // When
    fireEvent.pointerDown(screen.getByLabelText(`${LEFT_TAB} input`));

    // Then
    expect(layoutApi.getActivePanelId()).toBe(LEFT_TAB);
    expect(useWorkbenchStore.getState().panelFocusRequest).toBeNull();
  });
});

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OmoPermissionPresetSelector } from "@/components/chat/omo-permission-preset-selector";
import {
  OMO_PERMISSION_PRESET_DETAILS,
  OMO_PERMISSION_PRESETS,
} from "@/lib/omo/permission-presets";
import { useOmoPermissionPresetStore } from "@/stores/omo-permission-preset-store";

const useWorkspaceEngineMock = vi.hoisted(() => vi.fn());
const applyOmoPermissionPresetMock = vi.hoisted(() => vi.fn());
const toastErrorMock = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/use-workspace-engine", () => ({
  useWorkspaceEngine: useWorkspaceEngineMock,
}));
vi.mock("@/stores/omo-permission-preset-store", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/stores/omo-permission-preset-store")
    >();
  return { ...actual, applyOmoPermissionPreset: applyOmoPermissionPresetMock };
});
vi.mock("sonner", () => ({ toast: { error: toastErrorMock } }));

const WORKSPACE_ID = "ws-1";
const SESSION_ID = "omo_session-1";
const initialPresetState = useOmoPermissionPresetStore.getState();

function spyOnSetPreset() {
  const setPresetSpy = vi.fn(useOmoPermissionPresetStore.getState().setPreset);
  useOmoPermissionPresetStore.setState({ setPreset: setPresetSpy });
  return setPresetSpy;
}

function getTrigger() {
  return screen.getByRole("combobox", { name: "Permission mode" });
}

beforeEach(() => {
  vi.clearAllMocks();
  useOmoPermissionPresetStore.setState(initialPresetState, true);
  useWorkspaceEngineMock.mockReturnValue({ engine: "omo", isLoading: false });
  applyOmoPermissionPresetMock.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("OmoPermissionPresetSelector", () => {
  it("renders nothing for an opencode workspace", () => {
    useWorkspaceEngineMock.mockReturnValue({
      engine: "opencode",
      isLoading: false,
    });

    const { container } = render(
      <OmoPermissionPresetSelector
        workspaceId={WORKSPACE_ID}
        sessionId={SESSION_ID}
      />,
    );

    expect(container).toBeEmptyDOMElement();
    expect(useWorkspaceEngineMock).toHaveBeenCalledWith(WORKSPACE_ID);
  });

  it("shows Default when no preset is stored for the workspace", () => {
    render(
      <OmoPermissionPresetSelector
        workspaceId={WORKSPACE_ID}
        sessionId={SESSION_ID}
      />,
    );

    expect(getTrigger()).toHaveTextContent("Default");
  });

  it("lists every preset in order with its description and checks the current one", async () => {
    useOmoPermissionPresetStore.getState().setPreset(WORKSPACE_ID, "workspace");
    const user = userEvent.setup();
    render(
      <OmoPermissionPresetSelector
        workspaceId={WORKSPACE_ID}
        sessionId={SESSION_ID}
      />,
    );
    expect(getTrigger()).toHaveTextContent("Workspace");

    await user.click(getTrigger());

    const expectedOptions = OMO_PERMISSION_PRESETS.map((preset) => {
      const { label, description } = OMO_PERMISSION_PRESET_DETAILS[preset];
      const option = screen.getByRole("option", { name: label });
      expect(option).toHaveTextContent(description);
      expect(option).toHaveAccessibleDescription(description);
      expect(option).toHaveAttribute(
        "aria-checked",
        preset === "workspace" ? "true" : "false",
      );
      return option;
    });
    expect(screen.getAllByRole("option")).toEqual(expectedOptions);
    const currentOption = screen.getByRole("option", { name: "Workspace" });
    expect(currentOption.querySelector("svg")).toHaveClass("opacity-100");
    expect(currentOption).toHaveAttribute("aria-selected", "true");
  });

  it("stores and applies the picked preset to the open session", async () => {
    const setPresetSpy = spyOnSetPreset();
    const user = userEvent.setup();
    render(
      <OmoPermissionPresetSelector
        workspaceId={WORKSPACE_ID}
        sessionId={SESSION_ID}
      />,
    );

    await user.click(getTrigger());
    await user.click(screen.getByRole("option", { name: "Ask" }));

    expect(setPresetSpy).toHaveBeenCalledWith(WORKSPACE_ID, "ask");
    expect(applyOmoPermissionPresetMock).toHaveBeenCalledWith(
      WORKSPACE_ID,
      SESSION_ID,
      "ask",
    );
    expect(getTrigger()).toHaveTextContent("Ask");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("only stores the preset when there is no session yet", async () => {
    const setPresetSpy = spyOnSetPreset();
    const user = userEvent.setup();
    render(
      <OmoPermissionPresetSelector
        workspaceId={WORKSPACE_ID}
        sessionId={null}
      />,
    );

    await user.click(getTrigger());
    await user.click(screen.getByRole("option", { name: "Ask" }));

    expect(setPresetSpy).toHaveBeenCalledWith(WORKSPACE_ID, "ask");
    expect(applyOmoPermissionPresetMock).not.toHaveBeenCalled();
    expect(
      useOmoPermissionPresetStore.getState().presetByWorkspace[WORKSPACE_ID],
    ).toBe("ask");
  });

  it("shows the server's error in a toast when applying fails", async () => {
    applyOmoPermissionPresetMock.mockRejectedValue(
      new Error("omo refused the preset"),
    );
    const user = userEvent.setup();
    render(
      <OmoPermissionPresetSelector
        workspaceId={WORKSPACE_ID}
        sessionId={SESSION_ID}
      />,
    );

    await user.click(getTrigger());
    await user.click(screen.getByRole("option", { name: "Read only" }));

    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith("omo refused the preset"),
    );
    expect(getTrigger()).toHaveTextContent("Read only");
  });

  it("can be opened and picked with the keyboard", async () => {
    const setPresetSpy = spyOnSetPreset();
    const user = userEvent.setup();
    render(
      <OmoPermissionPresetSelector
        workspaceId={WORKSPACE_ID}
        sessionId={SESSION_ID}
      />,
    );

    await user.tab();
    expect(getTrigger()).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("listbox")).toHaveFocus();
    await user.keyboard("{ArrowDown}{Enter}");

    expect(setPresetSpy).toHaveBeenCalledWith(WORKSPACE_ID, "auto");
    expect(applyOmoPermissionPresetMock).toHaveBeenCalledWith(
      WORKSPACE_ID,
      SESSION_ID,
      "auto",
    );
  });
});

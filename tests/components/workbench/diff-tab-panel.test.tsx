import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DockviewReact } from "dockview-react";

import { DiffTabPanel } from "@/components/workbench/tabs/diff-tab-panel";
import type { OpenFileInWorkbenchInput } from "@/lib/workbench/open-in-workbench";
import type { DiffTabParams } from "@/lib/workbench/tab-descriptors";

interface CapturedDiffViewProps {
  readonly workspaceId: string;
  readonly filePath: string;
  readonly staged?: boolean;
  readonly baseRef?: string | null;
}

const { capturedDiffViewProps, openFileInWorkbenchMock, routerPushMock } =
  vi.hoisted(() => ({
    capturedDiffViewProps: [] as CapturedDiffViewProps[],
    openFileInWorkbenchMock: vi.fn<
      (input: OpenFileInWorkbenchInput) => Promise<boolean>
    >(async () => true),
    routerPushMock: vi.fn(),
  }));

vi.mock("@/components/workbench/workbench-diff-view", () => ({
  WorkbenchDiffView: (props: CapturedDiffViewProps) => {
    capturedDiffViewProps.push(props);
    return <div data-testid="workbench-diff-view">{props.filePath}</div>;
  },
}));

vi.mock("@/lib/workbench/open-in-workbench", () => ({
  openFileInWorkbench: openFileInWorkbenchMock,
}));

vi.mock("@/hooks/use-settings", () => ({
  useFileTabsSetting: () => ({ isFileTabsDisabled: true, isLoading: false }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPushMock, replace: vi.fn() }),
}));

function renderDiffTab(params: DiffTabParams) {
  render(
    <div style={{ width: 800, height: 600 }}>
      <DockviewReact
        components={{ diff: DiffTabPanel }}
        onReady={(event) => {
          event.api.addPanel({
            id: "diff-tab",
            component: "diff",
            params,
            title: params.path,
          });
        }}
      />
    </div>,
  );
}

function lastDiffViewProps(): CapturedDiffViewProps | undefined {
  return capturedDiffViewProps.at(-1);
}

afterEach(() => {
  capturedDiffViewProps.length = 0;
  openFileInWorkbenchMock.mockClear();
  routerPushMock.mockClear();
});

describe("DiffTabPanel", () => {
  it("passes staged=true and no baseRef for a staged diff", () => {
    // Given / When
    renderDiffTab({
      kind: "diff",
      workspaceId: "ws-1",
      path: "src/a.ts",
      source: "staged",
      baseRef: null,
    });

    // Then
    expect(lastDiffViewProps()).toEqual({
      workspaceId: "ws-1",
      filePath: "src/a.ts",
      staged: true,
      baseRef: null,
    });
    expect(screen.getByText("Staged")).toBeInTheDocument();
  });

  it("passes the baseRef and staged=false for a compare diff", () => {
    // Given / When
    renderDiffTab({
      kind: "diff",
      workspaceId: "ws-1",
      path: "src/a.ts",
      source: "compare",
      baseRef: "qa-base",
    });

    // Then
    expect(lastDiffViewProps()).toEqual({
      workspaceId: "ws-1",
      filePath: "src/a.ts",
      staged: false,
      baseRef: "qa-base",
    });
    expect(screen.getByText("vs qa-base")).toBeInTheDocument();
  });

  it("ignores a baseRef when the source is working", () => {
    // Given / When
    renderDiffTab({
      kind: "diff",
      workspaceId: "ws-1",
      path: "src/a.ts",
      source: "working",
      baseRef: "stale-ref",
    });

    // Then
    expect(lastDiffViewProps()).toEqual({
      workspaceId: "ws-1",
      filePath: "src/a.ts",
      staged: false,
      baseRef: null,
    });
    expect(screen.getByText("Working")).toBeInTheDocument();
  });

  it("ignores a baseRef when the source is staged", () => {
    // Given / When
    renderDiffTab({
      kind: "diff",
      workspaceId: "ws-1",
      path: "src/a.ts",
      source: "staged",
      baseRef: "stale-ref",
    });

    // Then
    expect(lastDiffViewProps()?.baseRef).toBeNull();
  });

  it("shows the diff path in the header", () => {
    // Given / When
    renderDiffTab({
      kind: "diff",
      workspaceId: "ws-1",
      path: "src/deep/a.ts",
      source: "working",
      baseRef: null,
    });

    // Then
    expect(screen.getByTestId("diff-tab-path")).toHaveTextContent(
      "src/deep/a.ts",
    );
  });

  it("opens the diffed file through the workbench opener", async () => {
    // Given
    renderDiffTab({
      kind: "diff",
      workspaceId: "ws-1",
      path: "src/a.ts",
      source: "compare",
      baseRef: "qa-base",
    });

    // When
    await userEvent.click(screen.getByRole("button", { name: /open file/i }));

    // Then
    expect(openFileInWorkbenchMock).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        workspaceId: "ws-1",
        path: "src/a.ts",
        isFileTabsDisabled: true,
      }),
    );
  });

  it("navigates with the router when the opener falls back to a link", async () => {
    // Given
    renderDiffTab({
      kind: "diff",
      workspaceId: "ws-1",
      path: "src/a.ts",
      source: "working",
      baseRef: null,
    });
    await userEvent.click(screen.getByRole("button", { name: /open file/i }));
    const [input] = openFileInWorkbenchMock.mock.lastCall ?? [];

    // When
    act(() => input?.navigate("/workbench?open=file"));

    // Then
    expect(routerPushMock).toHaveBeenCalledExactlyOnceWith(
      "/workbench?open=file",
    );
  });
});

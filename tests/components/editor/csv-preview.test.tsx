import { useEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { VirtuosoMockContext } from "react-virtuoso";
import {
  CsvPreviewFrame,
  CsvPreviewToggle,
} from "@/components/editor/csv-preview";
import { useEditorStore } from "@/stores/editor-store";
import type { FileComment } from "@/types";

const createComment = vi.hoisted(() => vi.fn());
let fileComments: FileComment[] = [];

vi.mock("@/hooks/use-file-comments", () => ({
  useFileComments: () => ({ data: fileComments }),
  useCreateFileComment: () => ({ mutate: createComment }),
  useResolveFileComment: () => ({ mutate: vi.fn() }),
  useDeleteFileComment: () => ({ mutate: vi.fn() }),
  useUpdateFileComment: () => ({ mutate: vi.fn() }),
}));

const onEditorMount = vi.fn();

function FakeEditor() {
  useEffect(() => {
    onEditorMount();
  }, []);
  return <div data-testid="fake-editor">editor</div>;
}

// Row 2's note spans file lines 2-3, so Alan's row starts on line 4.
const CSV_CONTENT = 'name,note\nAda,"first line\nsecond line"\nAlan,short';

function FileView({
  filePath,
  workspaceId,
}: {
  filePath: string;
  workspaceId: string | null;
}) {
  return (
    <VirtuosoMockContext.Provider
      value={{ viewportHeight: 2000, itemHeight: 28 }}
    >
      <div data-testid="header">
        <CsvPreviewToggle filePath={filePath} />
      </div>
      <CsvPreviewFrame
        content={CSV_CONTENT}
        filePath={filePath}
        workspaceId={workspaceId ?? undefined}
      >
        <FakeEditor />
      </CsvPreviewFrame>
    </VirtuosoMockContext.Provider>
  );
}

async function openTable(workspaceId: string | null = "ws1") {
  const user = userEvent.setup();
  render(<FileView filePath="data.csv" workspaceId={workspaceId} />);
  await user.click(screen.getByRole("button", { name: "Show CSV as table" }));
  await screen.findByRole("columnheader", { name: "name" });
  return user;
}

describe("CSV table preview", () => {
  beforeEach(() => {
    useEditorStore.getState().setCsvPreviewPath(null);
    fileComments = [];
    createComment.mockReset();
    onEditorMount.mockReset();
  });

  it("adds no toggle to the header for non-CSV files", () => {
    render(<FileView filePath="notes.txt" workspaceId="ws1" />);
    expect(screen.getByTestId("header")).toBeEmptyDOMElement();
  });

  it("shows the toggle for CSV files and starts in the editor", () => {
    render(<FileView filePath="exports/DATA.CSV" workspaceId="ws1" />);
    expect(
      screen.getByRole("button", { name: "Show CSV as table" }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("csv-preview")).not.toBeInTheDocument();
  });

  it("renders rows as table cells numbered by their starting file line", async () => {
    await openTable();
    expect(screen.getByRole("cell", { name: "Alan" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Add comment on line 4" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Add comment on line 3" }),
    ).not.toBeInTheDocument();
  });

  it("keeps the editor mounted while toggling the table on and off", async () => {
    const user = await openTable();
    await user.click(screen.getByRole("button", { name: "Edit CSV" }));
    expect(screen.queryByTestId("csv-preview")).not.toBeInTheDocument();
    expect(onEditorMount).toHaveBeenCalledTimes(1);
  });

  it("creates a comment covering every file line of a multi-line row", async () => {
    const user = await openTable();
    await user.click(
      screen.getByRole("button", { name: "Add comment on line 2" }),
    );
    await user.type(
      screen.getByPlaceholderText(/Add a comment/),
      "Check this note{Enter}",
    );
    expect(createComment).toHaveBeenCalledWith({
      workspaceId: "ws1",
      filePath: "data.csv",
      startLine: 2,
      endLine: 3,
      body: "Check this note",
      contentSnapshot: CSV_CONTENT,
      resolved: false,
    });
  });

  it("opens the comments sidebar from a row that already has a comment", async () => {
    fileComments = [
      {
        id: 7,
        workspaceId: "ws1",
        filePath: "data.csv",
        startLine: 4,
        endLine: 4,
        body: "Is Alan's note right?",
        contentSnapshot: null,
        resolved: false,
        createdAt: new Date(0),
        updatedAt: new Date(0),
      },
    ];
    const user = await openTable();
    await user.click(
      screen.getByRole("button", { name: "Show comments on line 4" }),
    );
    expect(screen.getByTestId("comments-sidebar")).toHaveTextContent(
      "Is Alan's note right?",
    );
  });

  it("shows the table without comment controls when there is no workspace", async () => {
    await openTable(null);
    expect(
      screen.queryByRole("button", { name: /Add comment on line/ }),
    ).not.toBeInTheDocument();
  });

  it("returns to the editor when a different CSV file is opened", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <FileView filePath="one.csv" workspaceId="ws1" />,
    );
    await user.click(screen.getByRole("button", { name: "Show CSV as table" }));
    await screen.findByTestId("csv-preview");
    rerender(<FileView filePath="two.csv" workspaceId="ws1" />);
    expect(screen.queryByTestId("csv-preview")).not.toBeInTheDocument();
  });
});

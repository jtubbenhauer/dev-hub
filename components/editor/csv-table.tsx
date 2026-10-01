"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { TableVirtuoso } from "react-virtuoso";
import type { TableComponents, TableVirtuosoHandle } from "react-virtuoso";
import { MessageCircle, Plus } from "lucide-react";
import { CommentInput } from "@/components/editor/comment-input";
import { CommentsSidebar } from "@/components/editor/comments-sidebar";
import {
  useCreateFileComment,
  useDeleteFileComment,
  useFileComments,
  useResolveFileComment,
  useUpdateFileComment,
} from "@/hooks/use-file-comments";
import { attachCommentToChat } from "@/lib/comment-chat-bridge";
import { getCsvColumnWidths, parseCsv } from "@/lib/csv";
import type { CsvRow } from "@/lib/csv";
import { cn } from "@/lib/utils";
import { useChatStore } from "@/stores/chat-store";
import type { FileComment } from "@/types";

const FLASH_DURATION_MS = 1500;

type TableItem =
  | { readonly kind: "row"; readonly row: CsvRow }
  | { readonly kind: "comment-input"; readonly row: CsvRow };

interface TableContext {
  readonly commentTargetRow: CsvRow | null;
  readonly flashedRow: CsvRow | null;
}

interface TableLayout {
  readonly columnWidths: readonly number[];
  readonly lineNumberDigits: number;
}

type CommentMarker = "none" | "add" | "show";

const tableComponents: TableComponents<TableItem, TableContext> = {
  Table: ({ children, style }) => (
    <table
      style={style}
      className="min-w-full border-separate border-spacing-0 font-mono text-xs"
    >
      {children}
    </table>
  ),
  TableRow: ({ item, context, ...rowProps }) => {
    const isHighlighted =
      item.kind === "row" &&
      (item.row === context.commentTargetRow ||
        item.row === context.flashedRow);
    return (
      <tr
        {...rowProps}
        className={cn(
          "group",
          isHighlighted
            ? "bg-blue-500/10"
            : item.kind === "row" && "hover:bg-muted/50",
        )}
      />
    );
  },
};

interface CsvRowCellsProps {
  row: CsvRow;
  isHeader: boolean;
  layout: TableLayout;
  commentMarker: CommentMarker;
  onCommentMarkerClick: (row: CsvRow) => void;
}

function CsvRowCells({
  row,
  isHeader,
  layout,
  commentMarker,
  onCommentMarkerClick,
}: CsvRowCellsProps) {
  const Cell = isHeader ? "th" : "td";
  const cellBackground = isHeader ? "bg-muted" : "bg-background";

  return (
    <>
      <Cell
        className={cn(
          "sticky left-0 z-[1] border-r border-b px-2 py-1.5 align-top font-normal",
          cellBackground,
        )}
      >
        <div className="flex items-center justify-end gap-1.5">
          {commentMarker !== "none" && (
            <button
              type="button"
              onClick={() => onCommentMarkerClick(row)}
              aria-label={
                commentMarker === "show"
                  ? `Show comments on line ${row.startLine}`
                  : `Add comment on line ${row.startLine}`
              }
              className={cn(
                "focus-visible:ring-ring flex size-4 shrink-0 items-center justify-center rounded-sm text-blue-500 outline-none focus-visible:ring-1",
                commentMarker === "add" &&
                  "opacity-0 transition-opacity group-hover:opacity-60 hover:opacity-100 focus-visible:opacity-100",
              )}
            >
              {commentMarker === "show" ? (
                <MessageCircle className="size-3.5 fill-current" />
              ) : (
                <Plus className="size-3.5" />
              )}
            </button>
          )}
          <span
            className="text-muted-foreground text-right tabular-nums"
            style={{ minWidth: `${layout.lineNumberDigits}ch` }}
          >
            {row.startLine}
          </span>
        </div>
      </Cell>
      {layout.columnWidths.map((width, columnIndex) => (
        <Cell
          key={columnIndex}
          className={cn(
            "border-r border-b px-3 py-1.5 text-left align-top",
            isHeader ? "bg-muted text-foreground font-medium" : "font-normal",
          )}
        >
          <div
            className="break-words whitespace-pre-wrap"
            style={{ width: `${width}ch` }}
          >
            {row.cells[columnIndex]}
          </div>
        </Cell>
      ))}
      <Cell
        aria-hidden
        className={cn("w-full border-b p-0", isHeader && "bg-muted")}
      />
    </>
  );
}

interface CsvTableProps {
  content: string;
  filePath: string;
  workspaceId?: string;
}

export function CsvTable({ content, filePath, workspaceId }: CsvTableProps) {
  const rows = useMemo(() => parseCsv(content), [content]);
  const headerRow: CsvRow | undefined = rows[0];
  const bodyRows = useMemo(() => rows.slice(1), [rows]);
  const layout = useMemo<TableLayout>(
    () => ({
      columnWidths: getCsvColumnWidths(rows),
      lineNumberDigits: String(rows.at(-1)?.endLine ?? 1).length,
    }),
    [rows],
  );

  const isCommentMode = Boolean(workspaceId);
  const activeSessionId = useChatStore((s) => s.activeSessionId);
  const { data: comments } = useFileComments(
    workspaceId ?? null,
    filePath,
    true,
  );
  const { mutate: createComment } = useCreateFileComment();
  const { mutate: resolveComment } = useResolveFileComment();
  const { mutate: deleteComment } = useDeleteFileComment();
  const { mutate: updateComment } = useUpdateFileComment();

  const [commentTargetRow, setCommentTargetRow] = useState<CsvRow | null>(null);
  const [flashedRow, setFlashedRow] = useState<CsvRow | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const virtuosoRef = useRef<TableVirtuosoHandle>(null);

  const commentedLines = useMemo(() => {
    const lines = new Set<number>();
    for (const comment of comments ?? []) {
      for (let line = comment.startLine; line <= comment.endLine; line++) {
        lines.add(line);
      }
    }
    return lines;
  }, [comments]);

  // The comment box is a virtualized item of its own, placed right under its
  // row (or first, when commenting on the sticky header row).
  const items = useMemo(() => {
    const tableItems: TableItem[] = [];
    if (commentTargetRow !== null && commentTargetRow === headerRow) {
      tableItems.push({ kind: "comment-input", row: commentTargetRow });
    }
    for (const row of bodyRows) {
      tableItems.push({ kind: "row", row });
      if (row === commentTargetRow) {
        tableItems.push({ kind: "comment-input", row });
      }
    }
    return tableItems;
  }, [bodyRows, headerRow, commentTargetRow]);

  const tableContext = useMemo<TableContext>(
    () => ({ commentTargetRow, flashedRow }),
    [commentTargetRow, flashedRow],
  );

  useEffect(() => {
    if (flashedRow === null) return;
    const timeoutId = setTimeout(() => setFlashedRow(null), FLASH_DURATION_MS);
    return () => clearTimeout(timeoutId);
  }, [flashedRow]);

  function getCommentMarker(row: CsvRow): CommentMarker {
    if (!isCommentMode) return "none";
    for (let line = row.startLine; line <= row.endLine; line++) {
      if (commentedLines.has(line)) return "show";
    }
    return "add";
  }

  function handleCommentMarkerClick(row: CsvRow) {
    if (getCommentMarker(row) === "show") {
      setIsSidebarOpen(true);
      setCommentTargetRow(null);
      return;
    }
    setCommentTargetRow(row);
    setIsSidebarOpen(false);
  }

  function handleCommentSubmit(body: string) {
    if (!workspaceId || !commentTargetRow) return;
    createComment({
      workspaceId,
      filePath,
      startLine: commentTargetRow.startLine,
      endLine: commentTargetRow.endLine,
      body,
      contentSnapshot: content,
      resolved: false,
    });
    setCommentTargetRow(null);
  }

  function handleScrollToLine(line: number) {
    if (headerRow && line <= headerRow.endLine) {
      virtuosoRef.current?.scrollToIndex(0);
      return;
    }
    const itemIndex = items.findIndex(
      (item) => item.kind === "row" && item.row.endLine >= line,
    );
    const targetItem = items.at(itemIndex);
    if (itemIndex === -1 || targetItem === undefined) return;
    virtuosoRef.current?.scrollToIndex({ index: itemIndex, align: "center" });
    setFlashedRow(targetItem.row);
  }

  function handleAttachToChat(comment: FileComment) {
    if (!workspaceId) return;
    attachCommentToChat({
      id: comment.id,
      filePath: comment.filePath,
      startLine: comment.startLine,
      endLine: comment.endLine,
      body: comment.body,
      workspaceId,
      sessionId: activeSessionId,
    });
  }

  if (headerRow === undefined) {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
        This CSV file is empty
      </div>
    );
  }

  const commentCount = comments?.length ?? 0;

  return (
    <div className="flex h-full w-full overflow-hidden">
      <div className="relative min-w-0 flex-1">
        <TableVirtuoso
          ref={virtuosoRef}
          className="@container"
          style={{ height: "100%" }}
          data={items}
          context={tableContext}
          components={tableComponents}
          computeItemKey={(_index, item) =>
            `${item.kind}-${item.row.startLine}`
          }
          fixedHeaderContent={() => (
            <tr className="group">
              <CsvRowCells
                row={headerRow}
                isHeader
                layout={layout}
                commentMarker={getCommentMarker(headerRow)}
                onCommentMarkerClick={handleCommentMarkerClick}
              />
            </tr>
          )}
          itemContent={(_index, item) => {
            switch (item.kind) {
              case "row":
                return (
                  <CsvRowCells
                    row={item.row}
                    isHeader={false}
                    layout={layout}
                    commentMarker={getCommentMarker(item.row)}
                    onCommentMarkerClick={handleCommentMarkerClick}
                  />
                );
              case "comment-input":
                return (
                  <td
                    colSpan={layout.columnWidths.length + 2}
                    className="border-b p-0"
                  >
                    <div className="sticky left-0 w-[min(100cqw,36rem)] p-2 font-sans">
                      <CommentInput
                        startLine={item.row.startLine}
                        endLine={item.row.endLine}
                        filePath={filePath}
                        onSubmit={handleCommentSubmit}
                        onCancel={() => setCommentTargetRow(null)}
                      />
                    </div>
                  </td>
                );
              default: {
                const unhandledItem: never = item;
                return unhandledItem;
              }
            }
          }}
        />

        {isCommentMode && commentCount > 0 && (
          <button
            type="button"
            className="bg-background/90 hover:bg-background absolute right-4 bottom-4 z-10 flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs shadow-sm"
            onClick={() => setIsSidebarOpen((isOpen) => !isOpen)}
            aria-label="Toggle comments"
          >
            <MessageCircle className="size-3.5" />
            <span className="bg-primary text-primary-foreground rounded-full px-1.5 py-0.5 text-[10px] leading-none">
              {commentCount}
            </span>
          </button>
        )}
      </div>

      {isCommentMode && isSidebarOpen && comments && (
        <div className="w-80 border-l">
          <CommentsSidebar
            comments={comments}
            onScrollToLine={handleScrollToLine}
            onResolve={(id) => resolveComment({ id, resolved: true })}
            onDelete={(id) => deleteComment(id)}
            onUpdate={(id, body) => updateComment({ id, body })}
            onAttachToChat={handleAttachToChat}
            onClose={() => setIsSidebarOpen(false)}
          />
        </div>
      )}
    </div>
  );
}

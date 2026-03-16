import { type Extension } from "@codemirror/state"
import { EditorView, gutter, GutterMarker } from "@codemirror/view"

class CommentGutterMarker extends GutterMarker {
  toDOM(): Node {
    const el = document.createElement("span")
    el.className = "cm-comment-gutter-dot"
    el.textContent = "●"
    return el
  }
}

const commentDot = new CommentGutterMarker()

export class AddCommentGutterMarker extends GutterMarker {
  toDOM(): Node {
    const btn = document.createElement("button")
    btn.className = "cm-comment-add-btn"
    btn.textContent = "+"
    btn.setAttribute("aria-label", "Add comment")
    return btn
  }
}

const addCommentBtn = new AddCommentGutterMarker()

export function createCommentGutterMarkers(options: {
  commentedLines: Set<number>
  onClickComment: (line: number) => void
  onAddComment: (startLine: number, endLine: number) => void
}): Extension {
  return gutter({
    class: "cm-comment-gutter",
    renderEmptyElements: true,
    lineMarker(view, line) {
      const lineNumber = view.state.doc.lineAt(line.from).number
      if (options.commentedLines.has(lineNumber)) {
        return commentDot
      }
      return addCommentBtn
    },
    domEventHandlers: {
      mousedown(_view, line, event) {
        const lineNumber = _view.state.doc.lineAt(line.from).number
        if (options.commentedLines.has(lineNumber)) {
          event.preventDefault()
          options.onClickComment(lineNumber)
          return true
        }
        event.preventDefault()
        options.onAddComment(lineNumber, lineNumber)
        return true
      },
    },
  })
}

const commentGutterTheme = EditorView.baseTheme({
  ".cm-comment-gutter .cm-comment-add-btn": {
    opacity: "0",
    background: "none",
    border: "1px solid transparent",
    borderRadius: "4px",
    cursor: "pointer",
    padding: "0 4px",
    color: "#3b82f6",
    fontSize: "14px",
    fontWeight: "700",
    lineHeight: "1",
    transition: "opacity 120ms, background 120ms, border-color 120ms",
  },
  ".cm-comment-gutter .cm-gutterElement:hover .cm-comment-add-btn": {
    opacity: "0.6",
  },
  ".cm-comment-gutter .cm-comment-add-btn:hover": {
    opacity: "1",
    background: "rgba(59, 130, 246, 0.1)",
    borderColor: "rgba(59, 130, 246, 0.3)",
  },
  ".cm-comment-gutter .cm-comment-gutter-dot": {
    cursor: "pointer",
  },
})

export function buildCommentExtensions(options: {
  onAddComment: (startLine: number, endLine: number) => void
  onClickComment: (line: number) => void
  commentedLines: Set<number>
}): Extension[] {
  return [
    createCommentGutterMarkers({
      onAddComment: options.onAddComment,
      onClickComment: options.onClickComment,
      commentedLines: options.commentedLines,
    }),
    commentGutterTheme,
  ]
}

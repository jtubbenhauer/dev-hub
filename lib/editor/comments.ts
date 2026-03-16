import {
  StateEffect,
  StateField,
  type Extension,
} from "@codemirror/state"
import {
  EditorView,
  WidgetType,
  Decoration,
  type DecorationSet,
  gutter,
  GutterMarker,
} from "@codemirror/view"

export const setCommentDecorations = StateEffect.define<DecorationSet>()

export const commentDecorationsField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none
  },
  update(deco, tr) {
    deco = deco.map(tr.changes)
    for (const e of tr.effects) {
      if (e.is(setCommentDecorations)) deco = e.value
    }
    return deco
  },
  provide: (f) => EditorView.decorations.from(f),
})

export class AddCommentWidget extends WidgetType {
  constructor(readonly line: number) {
    super()
  }

  toDOM(): HTMLElement {
    const btn = document.createElement("button")
    btn.className = "cm-comment-add-btn"
    btn.textContent = "+"
    btn.setAttribute("aria-label", "Add comment")
    return btn
  }

  eq(other: AddCommentWidget): boolean {
    return other.line === this.line
  }
}

class CommentGutterMarker extends GutterMarker {
  toDOM(): Node {
    const el = document.createElement("span")
    el.className = "cm-comment-gutter-dot"
    el.textContent = "●"
    return el
  }
}

const commentDot = new CommentGutterMarker()

export function createCommentGutterMarkers(options: {
  commentedLines: Set<number>
  onClickComment: (line: number) => void
}): Extension {
  return gutter({
    class: "cm-comment-gutter",
    lineMarker(view, line) {
      const lineNumber = view.state.doc.lineAt(line.from).number
      if (options.commentedLines.has(lineNumber)) {
        return commentDot
      }
      return null
    },
    domEventHandlers: {
      mousedown(_view, line, event) {
        const lineNumber = _view.state.doc.lineAt(line.from).number
        if (options.commentedLines.has(lineNumber)) {
          event.preventDefault()
          options.onClickComment(lineNumber)
          return true
        }
        return false
      },
    },
  })
}

export function buildCommentExtensions(options: {
  onAddComment: (startLine: number, endLine: number) => void
  onClickComment: (line: number) => void
  commentedLines: Set<number>
}): Extension[] {
  let hoveredLine: number | null = null

  return [
    commentDecorationsField,

    EditorView.domEventHandlers({
      mousemove(event, view) {
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
        if (pos === null) return

        const line = view.state.doc.lineAt(pos)
        const lineNumber = line.number

        if (hoveredLine === lineNumber) return
        hoveredLine = lineNumber

        const decoration = Decoration.widget({
          widget: new AddCommentWidget(lineNumber),
          side: 1,
        }).range(line.to)

        view.dispatch({
          effects: [setCommentDecorations.of(Decoration.set([decoration]))],
        })
      },
      mouseleave(_event, view) {
        hoveredLine = null
        view.dispatch({
          effects: [setCommentDecorations.of(Decoration.none)],
        })
      },
      mousedown(event, view) {
        const target = event.target as HTMLElement
        if (!target.classList.contains("cm-comment-add-btn")) return false

        event.preventDefault()
        event.stopPropagation()

        const sel = view.state.selection.main
        const hasSelection = sel.from !== sel.to
        let startLine: number
        let endLine: number

        if (hasSelection) {
          startLine = view.state.doc.lineAt(sel.from).number
          endLine = view.state.doc.lineAt(sel.to).number
        } else if (hoveredLine !== null) {
          startLine = hoveredLine
          endLine = hoveredLine
        } else {
          return false
        }

        options.onAddComment(startLine, endLine)
        return true
      },
    }),

    createCommentGutterMarkers({
      commentedLines: options.commentedLines,
      onClickComment: options.onClickComment,
    }),
  ]
}

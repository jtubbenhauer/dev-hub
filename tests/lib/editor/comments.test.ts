import { describe, it, expect, vi } from "vitest"

vi.mock("@codemirror/state", () => {
  const mockEffect = { is: vi.fn(() => false) }
  return {
    StateEffect: {
      define: vi.fn(() => ({
        of: vi.fn((val: unknown) => ({ ...mockEffect, value: val })),
        is: vi.fn(() => false),
      })),
    },
    StateField: {
      define: vi.fn((config: Record<string, unknown>) => ({
        _config: config,
      })),
    },
    RangeSet: {
      of: vi.fn(),
    },
  }
})

vi.mock("@codemirror/view", () => {
  class MockWidgetType {
    toDOM(): HTMLElement {
      return document.createElement("div")
    }
    eq(): boolean {
      return false
    }
  }

  class MockGutterMarker {
    toDOM(): Node {
      return document.createElement("span")
    }
  }

  return {
    EditorView: {
      decorations: { from: vi.fn() },
      domEventHandlers: vi.fn((handlers: Record<string, unknown>) => ({
        _type: "domEventHandlers",
        handlers,
      })),
    },
    WidgetType: MockWidgetType,
    Decoration: {
      none: {},
      widget: vi.fn(() => ({ range: vi.fn() })),
      set: vi.fn(),
    },
    gutter: vi.fn((config: Record<string, unknown>) => ({
      _type: "gutter",
      ...config,
    })),
    GutterMarker: MockGutterMarker,
    ViewPlugin: { fromClass: vi.fn() },
  }
})

import {
  setCommentDecorations,
  commentDecorationsField,
  AddCommentWidget,
  createCommentGutterMarkers,
  buildCommentExtensions,
} from "@/lib/editor/comments"

describe("lib/editor/comments", () => {
  describe("setCommentDecorations", () => {
    it("is defined as a StateEffect", () => {
      expect(setCommentDecorations).toBeDefined()
      expect(setCommentDecorations).not.toBeNull()
    })

    it("has an of() method for creating effect instances", () => {
      expect(typeof setCommentDecorations.of).toBe("function")
    })
  })

  describe("commentDecorationsField", () => {
    it("is defined as a StateField", () => {
      expect(commentDecorationsField).toBeDefined()
      expect(commentDecorationsField).not.toBeNull()
    })
  })

  describe("AddCommentWidget", () => {
    it("toDOM returns an HTMLButtonElement with class cm-comment-add-btn", () => {
      const widget = new AddCommentWidget(5)
      const el = widget.toDOM()

      expect(el).toBeInstanceOf(HTMLButtonElement)
      expect(el.className).toBe("cm-comment-add-btn")
      expect(el.textContent).toBe("+")
      expect(el.getAttribute("aria-label")).toBe("Add comment")
    })

    it("eq returns true for same line number", () => {
      const a = new AddCommentWidget(10)
      const b = new AddCommentWidget(10)
      expect(a.eq(b)).toBe(true)
    })

    it("eq returns false for different line number", () => {
      const a = new AddCommentWidget(10)
      const b = new AddCommentWidget(20)
      expect(a.eq(b)).toBe(false)
    })

    it("stores the line number", () => {
      const widget = new AddCommentWidget(42)
      expect(widget.line).toBe(42)
    })
  })

  describe("createCommentGutterMarkers", () => {
    it("returns a gutter extension", () => {
      const ext = createCommentGutterMarkers({
        commentedLines: new Set([1, 5]),
        onClickComment: vi.fn(),
      })
      expect(ext).toBeDefined()
    })
  })

  describe("buildCommentExtensions", () => {
    it("returns an array of extensions", () => {
      const extensions = buildCommentExtensions({
        onAddComment: vi.fn(),
        onClickComment: vi.fn(),
        commentedLines: new Set([1, 3]),
      })

      expect(Array.isArray(extensions)).toBe(true)
      expect(extensions.length).toBeGreaterThanOrEqual(3)
    })

    it("works with empty commentedLines set", () => {
      const extensions = buildCommentExtensions({
        onAddComment: vi.fn(),
        onClickComment: vi.fn(),
        commentedLines: new Set(),
      })

      expect(Array.isArray(extensions)).toBe(true)
      expect(extensions.length).toBeGreaterThanOrEqual(3)
    })

    it("includes commentDecorationsField in returned extensions", () => {
      const extensions = buildCommentExtensions({
        onAddComment: vi.fn(),
        onClickComment: vi.fn(),
        commentedLines: new Set(),
      })

      expect(extensions[0]).toBe(commentDecorationsField)
    })

    it("includes dom event handlers extension", () => {
      const extensions = buildCommentExtensions({
        onAddComment: vi.fn(),
        onClickComment: vi.fn(),
        commentedLines: new Set(),
      })

      const domHandlers = extensions[1] as { _type?: string }
      expect(domHandlers._type).toBe("domEventHandlers")
    })

    it("includes gutter extension", () => {
      const extensions = buildCommentExtensions({
        onAddComment: vi.fn(),
        onClickComment: vi.fn(),
        commentedLines: new Set(),
      })

      const gutterExt = extensions[2] as { _type?: string }
      expect(gutterExt._type).toBe("gutter")
    })
  })
})

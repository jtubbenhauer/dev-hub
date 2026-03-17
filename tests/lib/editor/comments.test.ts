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
      baseTheme: vi.fn((styles: unknown) => ({ _type: "baseTheme", styles })),
    },
    WidgetType: MockWidgetType,
    Decoration: {
      none: {},
    },
    gutter: vi.fn((config: Record<string, unknown>) => ({
      _type: "gutter",
      ...config,
    })),
    GutterMarker: MockGutterMarker,
  }
})

import {
  AddCommentGutterMarker,
  createCommentGutterMarkers,
  buildCommentExtensions,
} from "@/lib/editor/comments"

describe("lib/editor/comments", () => {
  describe("AddCommentGutterMarker", () => {
    it("toDOM returns a button with class cm-comment-add-btn", () => {
      const marker = new AddCommentGutterMarker()
      const el = marker.toDOM()
      expect(el).toBeInstanceOf(HTMLButtonElement)
      expect((el as HTMLElement).className).toBe("cm-comment-add-btn")
      expect((el as HTMLElement).textContent).toBe("+")
      expect((el as HTMLElement).getAttribute("aria-label")).toBe("Add comment")
    })
  })

  describe("createCommentGutterMarkers", () => {
    it("returns a gutter extension", () => {
      const ext = createCommentGutterMarkers({
        commentedLines: new Set([1, 5]),
        onClickComment: vi.fn(),
        onAddComment: vi.fn(),
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
      expect(extensions.length).toBeGreaterThanOrEqual(2)
    })

    it("works with empty commentedLines set", () => {
      const extensions = buildCommentExtensions({
        onAddComment: vi.fn(),
        onClickComment: vi.fn(),
        commentedLines: new Set(),
      })

      expect(Array.isArray(extensions)).toBe(true)
      expect(extensions.length).toBeGreaterThanOrEqual(2)
    })

    it("first element is a gutter extension", () => {
      const extensions = buildCommentExtensions({
        onAddComment: vi.fn(),
        onClickComment: vi.fn(),
        commentedLines: new Set(),
      })

      const gutterExt = extensions[0] as { _type?: string }
      expect(gutterExt._type).toBe("gutter")
    })

    it("gutter has renderEmptyElements: true", () => {
      const extensions = buildCommentExtensions({
        onAddComment: vi.fn(),
        onClickComment: vi.fn(),
        commentedLines: new Set(),
      })

      const gutterExt = extensions[0] as { renderEmptyElements?: boolean }
      expect(gutterExt.renderEmptyElements).toBe(true)
    })

    it("gutter has domEventHandlers with mousedown", () => {
      const extensions = buildCommentExtensions({
        onAddComment: vi.fn(),
        onClickComment: vi.fn(),
        commentedLines: new Set(),
      })

      const gutterExt = extensions[0] as { domEventHandlers?: Record<string, unknown> }
      expect(gutterExt.domEventHandlers).toBeDefined()
      expect(typeof gutterExt.domEventHandlers?.mousedown).toBe("function")
    })
  })
})

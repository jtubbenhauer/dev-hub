import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  attachCommentToChat,
  getPendingCommentChips,
  clearPendingCommentChips,
  removePendingCommentChip,
} from "@/lib/comment-chat-bridge";

const store: Record<string, string> = {};

vi.stubGlobal("localStorage", {
  getItem: (k: string) => store[k] ?? null,
  setItem: (k: string, v: string) => {
    store[k] = v;
  },
  removeItem: (k: string) => {
    delete store[k];
  },
});

const dispatchEventMock = vi.fn();
vi.stubGlobal("window", { dispatchEvent: dispatchEventMock });

beforeEach(() => {
  Object.keys(store).forEach((k) => {
    delete store[k];
  });
  dispatchEventMock.mockClear();
});

describe("comment-chat-bridge", () => {
  describe("attachCommentToChat", () => {
    it("adds item to localStorage", () => {
      const comment = {
        id: 1,
        filePath: "/path/to/file.ts",
        startLine: 10,
        endLine: 15,
        body: "This is a comment",
        workspaceId: "ws-test",
        sessionId: null,
      };
      attachCommentToChat(comment);

      const stored = getPendingCommentChips("ws-test");
      expect(stored).toHaveLength(1);
      expect(stored[0]).toEqual(comment);
    });

    it("deduplicates by id (second call with same id is no-op)", () => {
      const comment = {
        id: 1,
        filePath: "/path/to/file.ts",
        startLine: 10,
        endLine: 15,
        body: "This is a comment",
        workspaceId: "ws-test",
        sessionId: null,
      };
      attachCommentToChat(comment);
      attachCommentToChat(comment);

      const stored = getPendingCommentChips("ws-test");
      expect(stored).toHaveLength(1);
    });

    it("dispatches CustomEvent", () => {
      const comment = {
        id: 1,
        filePath: "/path/to/file.ts",
        startLine: 10,
        endLine: 15,
        body: "This is a comment",
        workspaceId: "ws-test",
        sessionId: null,
      };
      attachCommentToChat(comment);

      expect(dispatchEventMock).toHaveBeenCalledTimes(1);
      const event = dispatchEventMock.mock.calls[0][0] as CustomEvent;
      expect(event.type).toBe("attach-comment-to-chat");
    });
  });

  describe("getPendingCommentChips", () => {
    it("returns empty array when localStorage is empty", () => {
      const result = getPendingCommentChips("ws-test");
      expect(result).toEqual([]);
    });

    it("returns stored items", () => {
      const comments = [
        {
          id: 1,
          filePath: "/path/to/file1.ts",
          startLine: 10,
          endLine: 15,
          body: "Comment 1",
          workspaceId: "ws-test",
          sessionId: null,
        },
        {
          id: 2,
          filePath: "/path/to/file2.ts",
          startLine: 20,
          endLine: 25,
          body: "Comment 2",
          workspaceId: "ws-test",
          sessionId: null,
        },
      ];
      localStorage.setItem(
        "devhub:pending-comment-chips:ws-test",
        JSON.stringify(comments),
      );

      const result = getPendingCommentChips("ws-test");
      expect(result).toEqual(comments);
    });

    it("returns empty array when JSON parsing fails", () => {
      localStorage.setItem(
        "devhub:pending-comment-chips:ws-test",
        "invalid json",
      );
      const result = getPendingCommentChips("ws-test");
      expect(result).toEqual([]);
    });
  });

  describe("clearPendingCommentChips", () => {
    it("removes the key from localStorage", () => {
      localStorage.setItem(
        "devhub:pending-comment-chips:ws-test",
        JSON.stringify([{ id: 1 }]),
      );
      clearPendingCommentChips("ws-test");

      const result = localStorage.getItem(
        "devhub:pending-comment-chips:ws-test",
      );
      expect(result).toBeNull();
    });
  });

  describe("removePendingCommentChip", () => {
    it("removes specific item by id and leaves others", () => {
      const comments = [
        {
          id: 1,
          filePath: "/path/to/file1.ts",
          startLine: 10,
          endLine: 15,
          body: "Comment 1",
          workspaceId: "ws-test",
          sessionId: null,
        },
        {
          id: 2,
          filePath: "/path/to/file2.ts",
          startLine: 20,
          endLine: 25,
          body: "Comment 2",
          workspaceId: "ws-test",
          sessionId: null,
        },
      ];
      localStorage.setItem(
        "devhub:pending-comment-chips:ws-test",
        JSON.stringify(comments),
      );

      removePendingCommentChip("ws-test", 1);

      const result = getPendingCommentChips("ws-test");
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(2);
    });

    it("calls clearPendingCommentChips when last item is removed", () => {
      const comment = {
        id: 1,
        filePath: "/path/to/file.ts",
        startLine: 10,
        endLine: 15,
        body: "Comment",
        workspaceId: "ws-test",
        sessionId: null,
      };
      localStorage.setItem(
        "devhub:pending-comment-chips:ws-test",
        JSON.stringify([comment]),
      );

      removePendingCommentChip("ws-test", 1);

      const result = localStorage.getItem(
        "devhub:pending-comment-chips:ws-test",
      );
      expect(result).toBeNull();
    });
  });
});

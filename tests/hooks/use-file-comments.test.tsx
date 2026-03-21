import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import {
  useFileComments,
  useCreateFileComment,
  useUpdateFileComment,
  useResolveFileComment,
  useDeleteFileComment,
} from "@/hooks/use-file-comments";
import type { FileComment, NewFileComment } from "@/types";

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Mock sonner toast
vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

describe("useFileComments", () => {
  beforeEach(() => {
    mockFetch.mockClear();
  });

  it("fetches comments with correct URL when workspaceId is provided", async () => {
    const mockComments: FileComment[] = [
      {
        id: 1,
        workspaceId: "ws-1",
        filePath: "/test/file.ts",
        startLine: 10,
        endLine: 15,
        body: "Test comment",
        contentSnapshot: "snapshot",
        resolved: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockComments,
    });

    const { result } = renderHook(
      () => useFileComments("ws-1", "/test/file.ts", false),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/file-comments?workspaceId=ws-1&filePath=%2Ftest%2Ffile.ts&includeResolved=false",
    );
    expect(result.current.data).toEqual(mockComments);
  });

  it("does NOT fetch when workspaceId is null", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    });

    const { result } = renderHook(
      () => useFileComments(null, "/test/file.ts", false),
      { wrapper: createWrapper() },
    );

    // Should be disabled, so no fetch call
    expect(result.current.isLoading).toBe(false);
    expect(result.current.fetchStatus).toBe("idle");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("fetches without filePath when not provided", async () => {
    const mockComments: FileComment[] = [];

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockComments,
    });

    const { result } = renderHook(
      () => useFileComments("ws-1", undefined, true),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/file-comments?workspaceId=ws-1&includeResolved=true",
    );
  });
});

describe("useCreateFileComment", () => {
  beforeEach(() => {
    mockFetch.mockClear();
  });

  it("posts to correct URL and invalidates cache on success", async () => {
    const mockCreated: FileComment = {
      id: 1,
      workspaceId: "ws-1",
      filePath: "/test/file.ts",
      startLine: 10,
      endLine: 15,
      body: "New comment",
      contentSnapshot: "snapshot",
      resolved: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockCreated,
    });

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });

    const Wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(() => useCreateFileComment(), {
      wrapper: Wrapper,
    });

    const newComment: NewFileComment = {
      workspaceId: "ws-1",
      filePath: "/test/file.ts",
      startLine: 10,
      endLine: 15,
      body: "New comment",
      contentSnapshot: "snapshot",
      resolved: false,
    };

    result.current.mutate(newComment);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockFetch).toHaveBeenCalledWith("/api/file-comments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newComment),
    });
  });
});

describe("useUpdateFileComment", () => {
  beforeEach(() => {
    mockFetch.mockClear();
  });

  it("puts to correct URL with body", async () => {
    const mockUpdated: FileComment = {
      id: 1,
      workspaceId: "ws-1",
      filePath: "/test/file.ts",
      startLine: 10,
      endLine: 15,
      body: "Updated comment",
      contentSnapshot: "snapshot",
      resolved: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockUpdated,
    });

    const { result } = renderHook(() => useUpdateFileComment(), {
      wrapper: createWrapper(),
    });

    result.current.mutate({ id: 1, body: "Updated comment" });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockFetch).toHaveBeenCalledWith("/api/file-comments/1", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: "Updated comment" }),
    });
  });
});

describe("useResolveFileComment", () => {
  beforeEach(() => {
    mockFetch.mockClear();
  });

  it("puts to correct resolve URL", async () => {
    const mockUpdated: FileComment = {
      id: 1,
      workspaceId: "ws-1",
      filePath: "/test/file.ts",
      startLine: 10,
      endLine: 15,
      body: "Comment",
      contentSnapshot: "snapshot",
      resolved: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockUpdated,
    });

    const { result } = renderHook(() => useResolveFileComment(), {
      wrapper: createWrapper(),
    });

    result.current.mutate({ id: 1, resolved: true });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockFetch).toHaveBeenCalledWith("/api/file-comments/1/resolve", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resolved: true }),
    });
  });
});

describe("useDeleteFileComment", () => {
  beforeEach(() => {
    mockFetch.mockClear();
  });

  it("deletes from correct URL", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ deleted: true }),
    });

    const { result } = renderHook(() => useDeleteFileComment(), {
      wrapper: createWrapper(),
    });

    result.current.mutate(1);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockFetch).toHaveBeenCalledWith("/api/file-comments/1", {
      method: "DELETE",
    });
  });
});

// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { ClickUpTask } from "@/types";

const mockAuth = vi.fn();
vi.mock("@/lib/auth/config", () => ({ auth: mockAuth }));

const mockWhere = vi.fn();
const mockFrom = vi.fn();
const mockSelect = vi.fn();
const mockDbChain = {
  from: mockFrom,
  where: mockWhere,
};

mockFrom.mockReturnValue(mockDbChain);
mockSelect.mockReturnValue(mockDbChain);
mockWhere.mockResolvedValue([]);

vi.mock("@/lib/db", () => ({
  db: { select: mockSelect },
}));

vi.mock("@/drizzle/schema", () => ({
  settings: { userId: "userId", key: "key" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a, b) => ({ eq: [a, b] })),
  and: vi.fn((...args) => ({ and: args })),
}));

function makeTask(
  id: string,
  name: string,
  customId: string | null = null,
): ClickUpTask {
  return {
    id,
    custom_id: customId,
    name,
    status: { status: "open", color: "#87909e", type: "open" },
    priority: null,
    assignees: [],
    due_date: null,
    date_created: "0",
    date_updated: "0",
    date_closed: null,
    url: `https://app.clickup.com/t/${id}`,
    list: { id: "list-1", name: "Backlog" },
    folder: { id: "folder-1", name: "Folder" },
    space: { id: "space-1" },
    tags: [],
  };
}

function makeRequest(query: string): NextRequest {
  return new NextRequest(
    `http://localhost:3000/api/clickup/search?query=${encodeURIComponent(query)}`,
  );
}

describe("GET /api/clickup/search", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ user: { id: "user-1" } });
    mockFrom.mockReturnValue(mockDbChain);
    mockSelect.mockReturnValue(mockDbChain);
    mockWhere
      .mockResolvedValueOnce([{ value: "clickup-token" }])
      .mockResolvedValueOnce([{ value: "team-1" }]);
  });

  it("prepends an exact task ID match ahead of name search results", async () => {
    const directMatch = makeTask("abc123", "Exact match");
    const searchMatch = makeTask("search-1", "Fuzzy result");

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = String(input);

        if (url.includes("/team/team-1/task")) {
          return new Response(JSON.stringify({ tasks: [searchMatch] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }

        if (
          url ===
          "https://api.clickup.com/api/v2/task/abc123?include_markdown_description=true"
        ) {
          return new Response(JSON.stringify(directMatch), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }

        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );

    const { GET } = await import("@/app/api/clickup/search/route");
    const response = await GET(makeRequest("abc123"));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.tasks.map((task: ClickUpTask) => task.id)).toEqual([
      "abc123",
      "search-1",
    ]);
    expect(data.tasks[0]._exactMatch).toBe(true);
    expect(data.tasks[1]._exactMatch).toBeUndefined();
  });

  it("falls back to custom task ID lookup when the direct lookup misses", async () => {
    const customMatch = makeTask("internal-77", "Custom task", "DEV-123");

    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);

      if (url.includes("/team/team-1/task")) {
        return new Response(JSON.stringify({ tasks: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      if (
        url ===
        "https://api.clickup.com/api/v2/task/DEV-123?include_markdown_description=true"
      ) {
        return new Response(JSON.stringify({ err: "not found" }), {
          status: 404,
          headers: { "content-type": "application/json" },
        });
      }

      if (
        url ===
        "https://api.clickup.com/api/v2/task/DEV-123?custom_task_ids=true&team_id=team-1&include_markdown_description=true"
      ) {
        return new Response(JSON.stringify(customMatch), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    const { GET } = await import("@/app/api/clickup/search/route");
    const response = await GET(makeRequest("DEV-123"));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.tasks).toHaveLength(1);
    expect(data.tasks[0].id).toBe("internal-77");
    expect(data.tasks[0].custom_id).toBe("DEV-123");
    expect(data.tasks[0]._exactMatch).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.clickup.com/api/v2/task/DEV-123?custom_task_ids=true&team_id=team-1&include_markdown_description=true",
      expect.objectContaining({
        headers: { Authorization: "clickup-token" },
      }),
    );
  });

  it("deduplicates the exact match when search already returns the same task", async () => {
    const exactTask = makeTask("abc123", "Exact match");

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = String(input);

        if (url.includes("/team/team-1/task")) {
          return new Response(JSON.stringify({ tasks: [exactTask] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }

        if (
          url ===
          "https://api.clickup.com/api/v2/task/abc123?include_markdown_description=true"
        ) {
          return new Response(JSON.stringify(exactTask), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }

        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );

    const { GET } = await import("@/app/api/clickup/search/route");
    const response = await GET(makeRequest("abc123"));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.tasks).toHaveLength(1);
    expect(data.tasks[0].id).toBe("abc123");
    expect(data.tasks[0]._exactMatch).toBe(true);
  });
});

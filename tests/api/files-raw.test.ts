import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { NextRequest } from "next/server";

const { mockAuth, mockWhere } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockWhere: vi.fn(),
}));

vi.mock("@/lib/auth/config", () => ({ auth: mockAuth }));
vi.mock("@/lib/db", () => ({
  db: { select: () => ({ from: () => ({ where: mockWhere }) }) },
}));
vi.mock("@/drizzle/schema", () => ({
  workspaces: { id: "id", userId: "userId" },
}));
vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a, b) => ({ eq: [a, b] })),
  and: vi.fn((...args) => ({ and: args })),
}));

import { GET } from "@/app/api/files/raw/route";

const PDF_BYTES = Buffer.from("%PDF-1.4\n\0binary\xff\nend", "latin1");
let workspaceDir: string;

function request(query: string): NextRequest {
  return new NextRequest(`http://localhost/api/files/raw?${query}`);
}

beforeAll(() => {
  workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "raw-route-"));
  fs.mkdirSync(path.join(workspaceDir, "docs"));
  fs.writeFileSync(path.join(workspaceDir, "docs", "Report.PDF"), PDF_BYTES);
  fs.writeFileSync(path.join(workspaceDir, "index.html"), "<script></script>");
});

afterAll(() => {
  fs.rmSync(workspaceDir, { recursive: true, force: true });
});

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { id: "user-1" } });
  mockWhere.mockResolvedValue([
    { id: "ws-1", backend: "local", path: workspaceDir },
  ]);
});

describe("GET /api/files/raw", () => {
  it("returns 401 when not authenticated", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await GET(request("workspaceId=ws-1&path=docs/Report.PDF"));
    expect(res.status).toBe(401);
  });

  it("streams PDF bytes unchanged with a pdf content type", async () => {
    const res = await GET(request("workspaceId=ws-1&path=docs/Report.PDF"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toContain("inline");
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.equals(PDF_BYTES)).toBe(true);
  });

  it("refuses non-PDF files", async () => {
    const res = await GET(request("workspaceId=ws-1&path=index.html"));
    expect(res.status).toBe(415);
  });

  it("rejects path traversal", async () => {
    const res = await GET(request("workspaceId=ws-1&path=../outside.pdf"));
    expect(res.status).toBe(403);
  });

  it("returns 404 for missing files", async () => {
    const res = await GET(request("workspaceId=ws-1&path=missing.pdf"));
    expect(res.status).toBe(404);
  });

  it("returns 404 when the workspace is not owned by the user", async () => {
    mockWhere.mockResolvedValue([]);
    const res = await GET(request("workspaceId=ws-1&path=docs/Report.PDF"));
    expect(res.status).toBe(404);
  });
});

describe("GET /api/files/raw for remote workspaces", () => {
  beforeEach(() => {
    mockWhere.mockResolvedValue([
      {
        id: "ws-1",
        backend: "remote",
        path: "/workspace",
        agentUrl: "http://agent:7500",
      },
    ]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("proxies PDF bytes from the agent's /files/raw endpoint", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(PDF_BYTES, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await GET(request("workspaceId=ws-1&path=docs/Report.PDF"));

    const agentUrl = new URL(String(fetchMock.mock.calls[0][0]));
    expect(agentUrl.origin + agentUrl.pathname).toBe(
      "http://agent:7500/files/raw",
    );
    expect(agentUrl.searchParams.get("path")).toBe("docs/Report.PDF");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.equals(PDF_BYTES)).toBe(true);
  });

  it("forwards agent JSON errors with their status", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ error: "File not found" }, { status: 404 }),
        ),
    );

    const res = await GET(request("workspaceId=ws-1&path=missing.pdf"));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "File not found" });
  });

  it("explains when the agent is too old to have /files/raw", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("404 Not Found", { status: 404 })),
    );

    const res = await GET(request("workspaceId=ws-1&path=docs/Report.PDF"));

    expect(res.status).toBe(501);
    expect((await res.json()).error).toMatch(/out of date/);
  });

  it("returns 502 when the agent is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fail")));

    const res = await GET(request("workspaceId=ws-1&path=docs/Report.PDF"));

    expect(res.status).toBe(502);
  });

  it("still refuses non-PDF files without contacting the agent", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const res = await GET(request("workspaceId=ws-1&path=index.html"));

    expect(res.status).toBe(415);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

const mockAuth = vi.fn()
vi.mock("@/lib/auth/config", () => ({ auth: mockAuth }))

const mockReturning = vi.fn()
const mockWhere = vi.fn()
const mockSet = vi.fn()
const mockFrom = vi.fn()
const mockInnerJoin = vi.fn()
const mockSelect = vi.fn()
const mockInsert = vi.fn()
const mockUpdate = vi.fn()
const mockDelete = vi.fn()
const mockValues = vi.fn()

const mockDbChain = {
  from: mockFrom,
  where: mockWhere,
  innerJoin: mockInnerJoin,
  set: mockSet,
  values: mockValues,
  returning: mockReturning,
}

mockFrom.mockReturnValue(mockDbChain)
mockInnerJoin.mockReturnValue(mockDbChain)
mockWhere.mockReturnValue(mockDbChain)
mockSet.mockReturnValue(mockDbChain)
mockValues.mockReturnValue(mockDbChain)
mockReturning.mockResolvedValue([])

mockSelect.mockReturnValue(mockDbChain)
mockInsert.mockReturnValue(mockDbChain)
mockUpdate.mockReturnValue(mockDbChain)
mockDelete.mockReturnValue(mockDbChain)

vi.mock("@/lib/db", () => ({
  db: {
    select: mockSelect,
    insert: mockInsert,
    update: mockUpdate,
    delete: mockDelete,
  },
}))

vi.mock("@/drizzle/schema", () => ({
  fileComments: { id: "id", workspaceId: "workspaceId", filePath: "filePath", resolved: "resolved" },
  workspaces: { id: "id", userId: "userId" },
}))

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a, b) => ({ eq: [a, b] })),
  and: vi.fn((...args) => ({ and: args })),
}))

function makeRequest(method: string, url: string, body?: unknown): NextRequest {
  return new NextRequest(url, {
    method,
    body: body ? JSON.stringify(body) : undefined,
    headers: body ? { "content-type": "application/json" } : {},
  })
}

const authedSession = { user: { id: "user-1" } }

const sampleWorkspace = { id: "ws-1", userId: "user-1", name: "Test WS" }

const sampleComment = {
  id: 1,
  workspaceId: "ws-1",
  filePath: "src/foo.ts",
  startLine: 10,
  endLine: 15,
  body: "A comment",
  contentSnapshot: null,
  resolved: false,
  createdAt: new Date(),
  updatedAt: new Date(),
}

beforeEach(() => {
  vi.clearAllMocks()
  mockFrom.mockReturnValue(mockDbChain)
  mockInnerJoin.mockReturnValue(mockDbChain)
  mockWhere.mockReturnValue(mockDbChain)
  mockSet.mockReturnValue(mockDbChain)
  mockValues.mockReturnValue(mockDbChain)
  mockReturning.mockResolvedValue([sampleComment])
  mockSelect.mockReturnValue(mockDbChain)
  mockInsert.mockReturnValue(mockDbChain)
  mockUpdate.mockReturnValue(mockDbChain)
  mockDelete.mockReturnValue(mockDbChain)
})

describe("GET /api/file-comments", () => {
  it("returns 401 when not authenticated", async () => {
    mockAuth.mockResolvedValue(null)
    const { GET } = await import("@/app/api/file-comments/route")
    const req = makeRequest("GET", "http://localhost/api/file-comments?workspaceId=ws-1")
    const res = await GET(req)
    expect(res.status).toBe(401)
  })

  it("returns 400 when workspaceId is missing", async () => {
    mockAuth.mockResolvedValue(authedSession)
    const { GET } = await import("@/app/api/file-comments/route")
    const req = makeRequest("GET", "http://localhost/api/file-comments")
    const res = await GET(req)
    expect(res.status).toBe(400)
  })

  it("returns 404 when workspace not found or not owned", async () => {
    mockAuth.mockResolvedValue(authedSession)
    mockWhere.mockResolvedValue([])
    const { GET } = await import("@/app/api/file-comments/route")
    const req = makeRequest("GET", "http://localhost/api/file-comments?workspaceId=ws-1")
    const res = await GET(req)
    expect(res.status).toBe(404)
  })

  it("returns array of comments for owned workspace", async () => {
    mockAuth.mockResolvedValue(authedSession)
    mockWhere
      .mockResolvedValueOnce([sampleWorkspace])
      .mockResolvedValueOnce([sampleComment])
    const { GET } = await import("@/app/api/file-comments/route")
    const req = makeRequest("GET", "http://localhost/api/file-comments?workspaceId=ws-1")
    const res = await GET(req)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(Array.isArray(data)).toBe(true)
  })

  it("excludes resolved comments by default", async () => {
    mockAuth.mockResolvedValue(authedSession)
    mockWhere
      .mockResolvedValueOnce([sampleWorkspace])
      .mockResolvedValueOnce([])
    const { GET } = await import("@/app/api/file-comments/route")
    const req = makeRequest("GET", "http://localhost/api/file-comments?workspaceId=ws-1")
    const res = await GET(req)
    expect(res.status).toBe(200)
  })

  it("filters by filePath when provided", async () => {
    mockAuth.mockResolvedValue(authedSession)
    mockWhere
      .mockResolvedValueOnce([sampleWorkspace])
      .mockResolvedValueOnce([sampleComment])
    const { GET } = await import("@/app/api/file-comments/route")
    const req = makeRequest(
      "GET",
      "http://localhost/api/file-comments?workspaceId=ws-1&filePath=src%2Ffoo.ts"
    )
    const res = await GET(req)
    expect(res.status).toBe(200)
  })
})

describe("POST /api/file-comments", () => {
  it("returns 401 when not authenticated", async () => {
    mockAuth.mockResolvedValue(null)
    const { POST } = await import("@/app/api/file-comments/route")
    const req = makeRequest("POST", "http://localhost/api/file-comments", {
      workspaceId: "ws-1",
      filePath: "src/foo.ts",
      startLine: 1,
      endLine: 5,
      body: "comment",
    })
    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it("returns 400 when required fields are missing", async () => {
    mockAuth.mockResolvedValue(authedSession)
    const { POST } = await import("@/app/api/file-comments/route")
    const req = makeRequest("POST", "http://localhost/api/file-comments", {
      workspaceId: "ws-1",
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it("returns 404 when workspace not owned", async () => {
    mockAuth.mockResolvedValue(authedSession)
    mockWhere.mockResolvedValue([])
    const { POST } = await import("@/app/api/file-comments/route")
    const req = makeRequest("POST", "http://localhost/api/file-comments", {
      workspaceId: "ws-1",
      filePath: "src/foo.ts",
      startLine: 1,
      endLine: 5,
      body: "comment",
    })
    const res = await POST(req)
    expect(res.status).toBe(404)
  })

  it("creates comment and returns 201", async () => {
    mockAuth.mockResolvedValue(authedSession)
    mockWhere.mockResolvedValueOnce([sampleWorkspace])
    mockReturning.mockResolvedValueOnce([sampleComment])
    const { POST } = await import("@/app/api/file-comments/route")
    const req = makeRequest("POST", "http://localhost/api/file-comments", {
      workspaceId: "ws-1",
      filePath: "src/foo.ts",
      startLine: 10,
      endLine: 15,
      body: "A comment",
    })
    const res = await POST(req)
    expect(res.status).toBe(201)
    const data = await res.json()
    expect(data.body).toBe("A comment")
  })
})

describe("GET /api/file-comments/[id]", () => {
  it("returns 401 when not authenticated", async () => {
    mockAuth.mockResolvedValue(null)
    const { GET } = await import("@/app/api/file-comments/[id]/route")
    const req = makeRequest("GET", "http://localhost/api/file-comments/1")
    const res = await GET(req, { params: Promise.resolve({ id: "1" }) })
    expect(res.status).toBe(401)
  })

  it("returns 404 when comment not found", async () => {
    mockAuth.mockResolvedValue(authedSession)
    mockWhere.mockResolvedValue([])
    const { GET } = await import("@/app/api/file-comments/[id]/route")
    const req = makeRequest("GET", "http://localhost/api/file-comments/1")
    const res = await GET(req, { params: Promise.resolve({ id: "1" }) })
    expect(res.status).toBe(404)
  })

  it("returns the comment when found", async () => {
    mockAuth.mockResolvedValue(authedSession)
    mockWhere.mockResolvedValue([{ comment: sampleComment, workspace: sampleWorkspace }])
    const { GET } = await import("@/app/api/file-comments/[id]/route")
    const req = makeRequest("GET", "http://localhost/api/file-comments/1")
    const res = await GET(req, { params: Promise.resolve({ id: "1" }) })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.id).toBe(1)
  })
})

describe("PUT /api/file-comments/[id]", () => {
  it("returns 401 when not authenticated", async () => {
    mockAuth.mockResolvedValue(null)
    const { PUT } = await import("@/app/api/file-comments/[id]/route")
    const req = makeRequest("PUT", "http://localhost/api/file-comments/1", { body: "updated" })
    const res = await PUT(req, { params: Promise.resolve({ id: "1" }) })
    expect(res.status).toBe(401)
  })

  it("returns 404 when comment not owned", async () => {
    mockAuth.mockResolvedValue(authedSession)
    mockWhere.mockResolvedValue([])
    const { PUT } = await import("@/app/api/file-comments/[id]/route")
    const req = makeRequest("PUT", "http://localhost/api/file-comments/1", { body: "updated" })
    const res = await PUT(req, { params: Promise.resolve({ id: "1" }) })
    expect(res.status).toBe(404)
  })

  it("updates comment body and returns updated row", async () => {
    mockAuth.mockResolvedValue(authedSession)
    mockWhere.mockResolvedValueOnce([{ comment: sampleComment, workspace: sampleWorkspace }])
    const updatedComment = { ...sampleComment, body: "updated body" }
    mockReturning.mockResolvedValueOnce([updatedComment])
    const { PUT } = await import("@/app/api/file-comments/[id]/route")
    const req = makeRequest("PUT", "http://localhost/api/file-comments/1", { body: "updated body" })
    const res = await PUT(req, { params: Promise.resolve({ id: "1" }) })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.body).toBe("updated body")
  })
})

describe("DELETE /api/file-comments/[id]", () => {
  it("returns 401 when not authenticated", async () => {
    mockAuth.mockResolvedValue(null)
    const { DELETE } = await import("@/app/api/file-comments/[id]/route")
    const req = makeRequest("DELETE", "http://localhost/api/file-comments/1")
    const res = await DELETE(req, { params: Promise.resolve({ id: "1" }) })
    expect(res.status).toBe(401)
  })

  it("returns 404 when comment not found", async () => {
    mockAuth.mockResolvedValue(authedSession)
    mockWhere.mockResolvedValue([])
    const { DELETE } = await import("@/app/api/file-comments/[id]/route")
    const req = makeRequest("DELETE", "http://localhost/api/file-comments/1")
    const res = await DELETE(req, { params: Promise.resolve({ id: "1" }) })
    expect(res.status).toBe(404)
  })

  it("deletes comment and returns { deleted: true }", async () => {
    mockAuth.mockResolvedValue(authedSession)
    mockWhere
      .mockResolvedValueOnce([{ comment: sampleComment, workspace: sampleWorkspace }])
      .mockResolvedValue(undefined)
    const { DELETE } = await import("@/app/api/file-comments/[id]/route")
    const req = makeRequest("DELETE", "http://localhost/api/file-comments/1")
    const res = await DELETE(req, { params: Promise.resolve({ id: "1" }) })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.deleted).toBe(true)
  })
})

describe("PUT /api/file-comments/[id]/resolve", () => {
  it("returns 401 when not authenticated", async () => {
    mockAuth.mockResolvedValue(null)
    const { PUT } = await import("@/app/api/file-comments/[id]/resolve/route")
    const req = makeRequest("PUT", "http://localhost/api/file-comments/1/resolve", { resolved: true })
    const res = await PUT(req, { params: Promise.resolve({ id: "1" }) })
    expect(res.status).toBe(401)
  })

  it("returns 404 when comment not owned", async () => {
    mockAuth.mockResolvedValue(authedSession)
    mockWhere.mockResolvedValue([])
    const { PUT } = await import("@/app/api/file-comments/[id]/resolve/route")
    const req = makeRequest("PUT", "http://localhost/api/file-comments/1/resolve", { resolved: true })
    const res = await PUT(req, { params: Promise.resolve({ id: "1" }) })
    expect(res.status).toBe(404)
  })

  it("toggles resolved field and returns updated row", async () => {
    mockAuth.mockResolvedValue(authedSession)
    mockWhere.mockResolvedValueOnce([{ comment: sampleComment, workspace: sampleWorkspace }])
    const resolvedComment = { ...sampleComment, resolved: true }
    mockReturning.mockResolvedValueOnce([resolvedComment])
    const { PUT } = await import("@/app/api/file-comments/[id]/resolve/route")
    const req = makeRequest("PUT", "http://localhost/api/file-comments/1/resolve", { resolved: true })
    const res = await PUT(req, { params: Promise.resolve({ id: "1" }) })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.resolved).toBe(true)
  })

  it("returns 400 when resolved field is missing", async () => {
    mockAuth.mockResolvedValue(authedSession)
    mockWhere.mockResolvedValueOnce([{ comment: sampleComment, workspace: sampleWorkspace }])
    const { PUT } = await import("@/app/api/file-comments/[id]/resolve/route")
    const req = makeRequest("PUT", "http://localhost/api/file-comments/1/resolve", {})
    const res = await PUT(req, { params: Promise.resolve({ id: "1" }) })
    expect(res.status).toBe(400)
  })
})

// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { SystemStats, SystemSummary } from "@/types";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  getSystemSummary: vi.fn(),
  getSystemStats: vi.fn(),
  getSystemStatsWithHistory: vi.fn(),
}));
vi.mock("@/lib/auth/config", () => ({ auth: mocks.auth }));
vi.mock("@/lib/system/stats", () => ({
  getSystemSummary: mocks.getSystemSummary,
  getSystemStats: mocks.getSystemStats,
  getSystemStatsWithHistory: mocks.getSystemStatsWithHistory,
}));
import { GET } from "@/app/api/system/route";

const summary: SystemSummary = {
  cpu: { usage: 12.5, cores: 8, model: "Apple M2", speed: 3.5 },
  memory: {
    total: 16,
    used: 4,
    free: 12,
    usagePercent: 25,
    swapTotal: 0,
    swapUsed: 0,
    swapPercent: 0,
  },
  uptime: 100,
  timestamp: 1,
};
const fullStats: SystemStats = {
  ...summary,
  disks: [],
  network: [],
  processes: [],
};

function systemRequest(query: Record<string, string> = {}) {
  const url = new URL("http://localhost/api/system");
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value);
  }
  return new NextRequest(url);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: "user" } });
  mocks.getSystemSummary.mockResolvedValue(summary);
  mocks.getSystemStats.mockResolvedValue(fullStats);
  mocks.getSystemStatsWithHistory.mockResolvedValue({
    current: fullStats,
    history: {
      timestamps: [1],
      cpu: [12.5],
      memory: [25],
      networkTimestamps: [],
      networkRx: [],
      networkTx: [],
    },
  });
});

describe("GET /api/system", () => {
  it("returns only the summary for detail=summary", async () => {
    const response = await GET(systemRequest({ detail: "summary" }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toEqual(summary);
    for (const heavyKey of ["disks", "network", "processes"])
      expect(body).not.toHaveProperty(heavyKey);
    expect(mocks.getSystemStats).not.toHaveBeenCalled();
    expect(mocks.getSystemStatsWithHistory).not.toHaveBeenCalled();
  });

  it("returns full stats by default", async () => {
    const response = await GET(systemRequest());
    expect(await response.json()).toEqual(fullStats);
    expect(mocks.getSystemStats).toHaveBeenCalledOnce();
    expect(mocks.getSystemSummary).not.toHaveBeenCalled();
  });

  it("returns full stats with history for history=true", async () => {
    const response = await GET(systemRequest({ history: "true" }));
    const body = await response.json();
    expect(body.current).toEqual(fullStats);
    expect(body.history.cpu).toEqual([12.5]);
    expect(mocks.getSystemStatsWithHistory).toHaveBeenCalledOnce();
  });

  it("returns 401 without a session", async () => {
    mocks.auth.mockResolvedValue(null);
    const response = await GET(systemRequest({ detail: "summary" }));
    expect(response.status).toBe(401);
    expect(mocks.getSystemSummary).not.toHaveBeenCalled();
  });
});

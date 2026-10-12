// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const si = vi.hoisted(() => ({
  currentLoad: vi.fn(),
  cpu: vi.fn(),
  mem: vi.fn(),
  cpuTemperature: vi.fn(),
  fsSize: vi.fn(),
  networkStats: vi.fn(),
  processes: vi.fn(),
  time: vi.fn(),
}));
const osMock = vi.hoisted(() => ({ uptime: vi.fn() }));

vi.mock("systeminformation", () => ({ default: si }));
vi.mock("node:os", () => ({ default: osMock, uptime: osMock.uptime }));

const FIVE_MINUTES_MS = 5 * 60 * 1_000;
let currentLoadDelayMs = 0;
let activeLoadCount = 0;
let maxActiveLoadCount = 0;
let loadValue = 0;

function resetSystemInformationMocks() {
  currentLoadDelayMs = 0;
  activeLoadCount = 0;
  maxActiveLoadCount = 0;
  loadValue = 0;
  for (const mock of Object.values(si)) mock.mockReset();
  si.currentLoad.mockImplementation(() => {
    activeLoadCount += 1;
    maxActiveLoadCount = Math.max(maxActiveLoadCount, activeLoadCount);
    loadValue += 1;
    const data = { currentLoad: loadValue + 0.04 };
    return new Promise((resolve) => {
      const finish = () => {
        activeLoadCount -= 1;
        resolve(data);
      };
      if (currentLoadDelayMs === 0) queueMicrotask(finish);
      else setTimeout(finish, currentLoadDelayMs);
    });
  });
  si.cpu.mockResolvedValue({
    cores: 8,
    manufacturer: "Apple",
    brand: "M2",
    speed: 3.5,
  });
  si.mem.mockResolvedValue({
    total: 16_000,
    used: 4_000,
    free: 12_000,
    swaptotal: 2_000,
    swapused: 500,
  });
  si.cpuTemperature.mockResolvedValue({ main: 51 });
  si.fsSize.mockResolvedValue([
    {
      mount: "/",
      type: "apfs",
      size: 2_000_000_000,
      used: 500_000_000,
      available: 1_500_000_000,
      use: 25.04,
    },
    {
      mount: "/mnt/c",
      type: "9p",
      size: 2_000_000_000,
      used: 1,
      available: 1,
      use: 1,
    },
  ]);
  si.networkStats.mockResolvedValue([
    { iface: "en0", rx_sec: 100, tx_sec: 40 },
    { iface: "en1", rx_sec: 20, tx_sec: 2 },
  ]);
  si.processes.mockImplementation(async () => ({
    list: [
      {
        pid: 1,
        name: "node",
        cpu: 12.34,
        mem: 1.26,
        memRss: 99,
        user: "me",
        command: "node server",
      },
    ],
  }));
  osMock.uptime.mockReturnValue(3_661.9);
}

async function loadStatsModule() {
  vi.resetModules();
  return import("@/lib/system/stats");
}

function collectionCount() {
  return si.currentLoad.mock.calls.length;
}

function fullCollectionCount() {
  return si.processes.mock.calls.length;
}

async function settle<T>(promise: Promise<T>): Promise<T> {
  await vi.advanceTimersByTimeAsync(currentLoadDelayMs);
  return promise;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  resetSystemInformationMocks();
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("system stats collection", () => {
  it("collects a summary without the heavy commands", async () => {
    const stats = await loadStatsModule();
    const summary = await settle(stats.getSystemSummary());

    expect(summary).toEqual({
      cpu: {
        usage: 1,
        cores: 8,
        model: "Apple M2",
        speed: 3.5,
        temperature: 51,
      },
      memory: {
        total: 16_000,
        used: 4_000,
        free: 12_000,
        usagePercent: 25,
        swapTotal: 2_000,
        swapUsed: 500,
        swapPercent: 25,
      },
      uptime: 3_661,
      timestamp: Date.now(),
    });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(collectionCount()).toBe(5);
    for (const heavyCommand of [
      si.fsSize,
      si.networkStats,
      si.processes,
      si.time,
    ])
      expect(heavyCommand).not.toHaveBeenCalled();
  });

  it("maps a full collection the same way as before", async () => {
    const stats = await loadStatsModule();
    const full = await settle(stats.getSystemStats());

    expect(full.disks).toEqual([
      {
        mount: "/",
        type: "apfs",
        size: 2_000_000_000,
        used: 500_000_000,
        available: 1_500_000_000,
        usagePercent: 25,
      },
    ]);
    expect(full.network).toEqual([
      { iface: "en0", rxSec: 100, txSec: 40 },
      { iface: "en1", rxSec: 20, txSec: 2 },
    ]);
    expect(full.processes).toEqual([
      {
        pid: 1,
        name: "node",
        cpu: 12.3,
        memory: 1.3,
        memRss: 99,
        user: "me",
        command: "node server",
      },
    ]);
    expect(full.uptime).toBe(3_661);
    expect(si.currentLoad).toHaveBeenCalledOnce();
    expect(si.time).not.toHaveBeenCalled();
  });

  it("fetches static CPU info once and retries after a rejection", async () => {
    si.cpu.mockRejectedValueOnce(new Error("cpu lookup failed"));
    const stats = await loadStatsModule();

    await expect(stats.getSystemSummary()).rejects.toThrow("cpu lookup failed");
    expect(si.cpu).toHaveBeenCalledTimes(1);

    const summary = await settle(stats.getSystemSummary());
    expect(summary.cpu.model).toBe("Apple M2");
    expect(si.cpu).toHaveBeenCalledTimes(2);

    await settle(stats.getSystemStats());
    await vi.advanceTimersByTimeAsync(30_000);
    expect(collectionCount()).toBeGreaterThan(5);
    expect(si.cpu).toHaveBeenCalledTimes(2);
  });

  it("collects full on loop ticks only within 15 s of a full request", async () => {
    const stats = await loadStatsModule();
    await settle(stats.getSystemSummary());
    await vi.advanceTimersByTimeAsync(10_000);
    expect(collectionCount()).toBe(3);
    expect(fullCollectionCount()).toBe(0);

    await settle(stats.getSystemStats());
    expect(fullCollectionCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(collectionCount()).toBe(6);
    expect(fullCollectionCount()).toBe(3);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(collectionCount()).toBe(8);
    expect(fullCollectionCount()).toBe(3);
  });

  it("dedupes concurrent requests and never overlaps collections", async () => {
    currentLoadDelayMs = 100;
    const stats = await loadStatsModule();

    const firstFull = stats.getSystemStats();
    const secondFull = stats.getSystemStats();
    const summaryDuringFull = stats.getSystemSummary();
    expect(collectionCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(100);
    const [first, second, summary] = await Promise.all([
      firstFull,
      secondFull,
      summaryDuringFull,
    ]);
    expect(second).toBe(first);
    expect(summary).not.toHaveProperty("processes");
    expect(collectionCount()).toBe(1);
    expect(fullCollectionCount()).toBe(1);
    expect(maxActiveLoadCount).toBe(1);
  });

  it("runs a full collection after an in-flight summary instead of in parallel", async () => {
    currentLoadDelayMs = 100;
    const stats = await loadStatsModule();

    const summary = stats.getSystemSummary();
    const full = stats.getSystemStats();
    const secondFull = stats.getSystemStats();
    expect(collectionCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(100);
    expect(collectionCount()).toBe(2);
    await vi.advanceTimersByTimeAsync(100);
    const [summaryResult, fullResult, secondFullResult] = await Promise.all([
      summary,
      full,
      secondFull,
    ]);
    expect(summaryResult).not.toHaveProperty("disks");
    expect(fullResult.processes).toHaveLength(1);
    expect(secondFullResult).toBe(fullResult);
    expect(fullCollectionCount()).toBe(1);
    expect(maxActiveLoadCount).toBe(1);
  });

  it("lets a full request wait for an in-flight loop tick", async () => {
    currentLoadDelayMs = 100;
    const stats = await loadStatsModule();
    await settle(stats.getSystemSummary());

    await vi.advanceTimersByTimeAsync(4_900);
    expect(collectionCount()).toBe(2);
    const fullDuringTick = stats.getSystemStats();
    expect(collectionCount()).toBe(2);
    await vi.advanceTimersByTimeAsync(200);
    expect((await fullDuringTick).processes).toHaveLength(1);
    expect(collectionCount()).toBe(3);
    expect(fullCollectionCount()).toBe(1);
    expect(maxActiveLoadCount).toBe(1);
  });

  it("serves requests inside the fresh window from cache", async () => {
    const stats = await loadStatsModule();
    const summary = await settle(stats.getSystemSummary());

    await vi.advanceTimersByTimeAsync(3_000);
    expect(await stats.getSystemSummary()).toEqual(summary);
    expect(collectionCount()).toBe(1);

    // A fresh summary does not satisfy a full request.
    const full = await settle(stats.getSystemStats());
    expect(collectionCount()).toBe(2);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(await stats.getSystemStats()).toBe(full);
    const summaryFromFull = await stats.getSystemSummary();
    expect(summaryFromFull).toEqual({
      cpu: full.cpu,
      memory: full.memory,
      uptime: full.uptime,
      timestamp: full.timestamp,
    });
    expect(summaryFromFull).not.toHaveProperty("network");
    expect(collectionCount()).toBe(2);
  });

  it("records cpu and memory for every collection and network only for full ones", async () => {
    const stats = await loadStatsModule();
    await settle(stats.getSystemSummary());
    for (let tick = 0; tick < 70; tick++) {
      await vi.advanceTimersByTimeAsync(5_000);
      if (tick % 10 === 0) await stats.getSystemSummary();
    }

    let { current, history } = await settle(stats.getSystemStatsWithHistory());
    expect(history.cpu).toHaveLength(60);
    expect(history.memory).toHaveLength(60);
    expect(history.timestamps).toHaveLength(60);
    expect(history.networkRx).toEqual([120]);
    expect(history.networkTx).toEqual([42]);
    expect(history.networkTimestamps).toEqual([current.timestamp]);
    expect(history.timestamps.at(-1)).toBe(current.timestamp);

    for (let tick = 0; tick < 70; tick++) {
      await vi.advanceTimersByTimeAsync(5_000);
      if (tick % 2 === 0) await stats.getSystemStats();
    }
    ({ current, history } = await stats.getSystemStatsWithHistory());
    expect(history.cpu).toHaveLength(60);
    expect(history.networkRx).toHaveLength(60);
    expect(history.networkTx).toHaveLength(60);
    expect(history.networkTimestamps).toEqual(history.timestamps);
  });

  it("stops the loop after five minutes without requests", async () => {
    const stats = await loadStatsModule();
    await settle(stats.getSystemSummary());
    expect(vi.getTimerCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(FIVE_MINUTES_MS + 5_000);
    const collectionsAtStop = collectionCount();
    expect(collectionsAtStop).toBe(61);
    expect(vi.getTimerCount()).toBe(0);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(collectionCount()).toBe(collectionsAtStop);

    await settle(stats.getSystemSummary());
    expect(vi.getTimerCount()).toBe(1);
  });
});

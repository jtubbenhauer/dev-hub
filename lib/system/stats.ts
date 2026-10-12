import os from "node:os";
import si from "systeminformation";
import type { Systeminformation } from "systeminformation";
import type {
  SystemSummary,
  SystemStats,
  SystemStatsWithHistory,
  CpuStats,
  MemoryStats,
  DiskStats,
  NetworkStats,
  ProcessInfo,
  SystemStatsHistory,
} from "@/types";

const RING_BUFFER_SIZE = 60; // 5 minutes at 5s intervals
const COLLECTION_INTERVAL_MS = 5_000;
const STATS_FRESH_MS = COLLECTION_INTERVAL_MS + 1_000;
const FULL_ACTIVE_WINDOW_MS = 15_000; // loop collects full stats while full requests keep arriving
const IDLE_STOP_MS = 5 * 60 * 1_000; // stop background collection after 5min of no requests

type InFlightCollection =
  | { kind: "summary"; promise: Promise<SystemSummary> }
  | { kind: "full"; promise: Promise<SystemStats> };

interface CpuStaticInfo {
  cores: number;
  model: string;
  speed: number;
}

// Ring buffer — only scalar series for sparklines
const history: SystemStatsHistory = {
  timestamps: [],
  cpu: [],
  memory: [],
  networkTimestamps: [],
  networkRx: [],
  networkTx: [],
};

let cpuStaticInfoPromise: Promise<CpuStaticInfo> | null = null;
let inFlightCollection: InFlightCollection | null = null;
let latestResult: SystemSummary | null = null;
let latestResultAt = 0;
let latestFullResult: SystemStats | null = null;
let latestFullResultAt = 0;
let collectionTimer: ReturnType<typeof setInterval> | null = null;
let lastRequestAt = 0;
let lastFullRequestAt = 0;

function pushCapped(series: number[], value: number) {
  series.push(value);
  if (series.length > RING_BUFFER_SIZE) series.shift();
}

function pushToRingBuffer(result: SystemSummary | SystemStats) {
  pushCapped(history.timestamps, result.timestamp);
  pushCapped(history.cpu, result.cpu.usage);
  pushCapped(history.memory, result.memory.usagePercent);

  if (!("network" in result)) return;
  const totalRx = result.network.reduce((sum, n) => sum + n.rxSec, 0);
  const totalTx = result.network.reduce((sum, n) => sum + n.txSec, 0);
  pushCapped(history.networkTimestamps, result.timestamp);
  pushCapped(history.networkRx, totalRx);
  pushCapped(history.networkTx, totalTx);
}

function getCpuStaticInfo(): Promise<CpuStaticInfo> {
  if (cpuStaticInfoPromise) return cpuStaticInfoPromise;
  const promise = si.cpu().then((cpuData) => ({
    cores: cpuData.cores,
    model: `${cpuData.manufacturer} ${cpuData.brand}`.trim(),
    speed: cpuData.speed,
  }));
  cpuStaticInfoPromise = promise;
  // A failed lookup must not stay memoized, so the next collection retries.
  promise.catch(() => {
    if (cpuStaticInfoPromise === promise) cpuStaticInfoPromise = null;
  });
  return promise;
}

function buildSummary(
  cpuLoad: Systeminformation.CurrentLoadData,
  mem: Systeminformation.MemData,
  temp: Systeminformation.CpuTemperatureData | null,
  cpuInfo: CpuStaticInfo,
): SystemSummary {
  const cpu: CpuStats = {
    usage: Math.round(cpuLoad.currentLoad * 10) / 10,
    cores: cpuInfo.cores,
    model: cpuInfo.model,
    speed: cpuInfo.speed,
    temperature: temp?.main && temp.main > 0 ? temp.main : undefined,
  };

  const memory: MemoryStats = {
    total: mem.total,
    used: mem.used,
    free: mem.free,
    usagePercent: Math.round((mem.used / mem.total) * 1000) / 10,
    swapTotal: mem.swaptotal,
    swapUsed: mem.swapused,
    swapPercent:
      mem.swaptotal > 0
        ? Math.round((mem.swapused / mem.swaptotal) * 1000) / 10
        : 0,
  };

  return {
    cpu,
    memory,
    uptime: Math.floor(os.uptime()),
    timestamp: Date.now(),
  };
}

async function collectSummary(): Promise<SystemSummary> {
  const [cpuLoad, mem, temp, cpuInfo] = await Promise.all([
    si.currentLoad(),
    si.mem(),
    si.cpuTemperature().catch(() => null),
    getCpuStaticInfo(),
  ]);
  return buildSummary(cpuLoad, mem, temp, cpuInfo);
}

async function collectFull(): Promise<SystemStats> {
  const [cpuLoad, mem, temp, cpuInfo, disksRaw, networkRaw, processes] =
    await Promise.all([
      si.currentLoad(),
      si.mem(),
      si.cpuTemperature().catch(() => null),
      getCpuStaticInfo(),
      si.fsSize(),
      si.networkStats(),
      si.processes(),
    ]);

  // Filter out /mnt/* mounts (Windows drives in WSL) and tiny pseudo-filesystems
  const disks: DiskStats[] = disksRaw
    .filter((d) => !d.mount.startsWith("/mnt/") && d.size > 1_073_741_824)
    .map((d) => ({
      mount: d.mount,
      type: d.type,
      size: d.size,
      used: d.used,
      available: d.available,
      usagePercent: Math.round(d.use * 10) / 10,
    }));

  const network: NetworkStats[] = (
    Array.isArray(networkRaw) ? networkRaw : [networkRaw]
  )
    .filter((n) => n.iface && n.rx_sec !== null && n.tx_sec !== null)
    .map((n) => ({
      iface: n.iface,
      rxSec: Math.max(0, n.rx_sec ?? 0),
      txSec: Math.max(0, n.tx_sec ?? 0),
    }));

  const topProcesses: ProcessInfo[] = processes.list
    .sort((a, b) => b.cpu - a.cpu)
    .slice(0, 20)
    .map((p) => ({
      pid: p.pid,
      name: p.name,
      cpu: Math.round(p.cpu * 10) / 10,
      memory: Math.round(p.mem * 10) / 10,
      memRss: p.memRss,
      user: p.user,
      command: p.command,
    }));

  const summary = buildSummary(cpuLoad, mem, temp, cpuInfo);
  return {
    cpu: summary.cpu,
    memory: summary.memory,
    disks,
    network,
    processes: topProcesses,
    uptime: summary.uptime,
    timestamp: summary.timestamp,
  };
}

function recordCollection(result: SystemSummary | SystemStats) {
  const now = Date.now();
  latestResult = result;
  latestResultAt = now;
  if ("network" in result) {
    latestFullResult = result;
    latestFullResultAt = now;
  }
  pushToRingBuffer(result);
}

// si.currentLoad() and si.networkStats() measure since their previous call,
// so callers must never start a collection while another one is in flight.
function startSummaryCollection(): Promise<SystemSummary> {
  const promise = collectSummary().then((result) => {
    recordCollection(result);
    return result;
  });
  trackInFlight({ kind: "summary", promise });
  return promise;
}

function startFullCollection(): Promise<SystemStats> {
  const promise = collectFull().then((result) => {
    recordCollection(result);
    return result;
  });
  trackInFlight({ kind: "full", promise });
  return promise;
}

function trackInFlight(collection: InFlightCollection) {
  inFlightCollection = collection;
  const clearWhenSettled = () => {
    if (inFlightCollection === collection) inFlightCollection = null;
  };
  collection.promise.then(clearWhenSettled, clearWhenSettled);
}

function obtainSummary(): Promise<SystemSummary> {
  if (inFlightCollection) return inFlightCollection.promise;
  return startSummaryCollection();
}

async function obtainFull(): Promise<SystemStats> {
  const current = inFlightCollection;
  if (!current) return startFullCollection();
  if (current.kind === "full") return current.promise;
  await current.promise.catch(() => undefined);
  // Another caller may have started a full collection while this one waited.
  return obtainFull();
}

function isFresh(collectedAt: number, now: number): boolean {
  return now - collectedAt < STATS_FRESH_MS;
}

function toSummary(result: SystemSummary): SystemSummary {
  return {
    cpu: result.cpu,
    memory: result.memory,
    uptime: result.uptime,
    timestamp: result.timestamp,
  };
}

async function runCollectionTick() {
  const now = Date.now();
  if (now - lastRequestAt > IDLE_STOP_MS) {
    stopCollection();
    return;
  }
  const shouldCollectFull = now - lastFullRequestAt < FULL_ACTIVE_WINDOW_MS;
  try {
    if (shouldCollectFull) await obtainFull();
    else await obtainSummary();
  } catch {
    // silently swallow — transient collection errors shouldn't crash the server
  }
}

function startCollection() {
  if (collectionTimer) return;
  collectionTimer = setInterval(() => {
    void runCollectionTick();
  }, COLLECTION_INTERVAL_MS);
}

function stopCollection() {
  if (collectionTimer) {
    clearInterval(collectionTimer);
    collectionTimer = null;
  }
}

export async function getSystemSummary(): Promise<SystemSummary> {
  const now = Date.now();
  lastRequestAt = now;
  startCollection();

  if (latestResult && isFresh(latestResultAt, now)) {
    return toSummary(latestResult);
  }
  return toSummary(await obtainSummary());
}

export async function getSystemStats(): Promise<SystemStats> {
  const now = Date.now();
  lastRequestAt = now;
  lastFullRequestAt = now;
  startCollection();

  if (latestFullResult && isFresh(latestFullResultAt, now)) {
    return latestFullResult;
  }
  return obtainFull();
}

export async function getSystemStatsWithHistory(): Promise<SystemStatsWithHistory> {
  const current = await getSystemStats();
  return {
    current,
    history: {
      timestamps: [...history.timestamps],
      cpu: [...history.cpu],
      memory: [...history.memory],
      networkTimestamps: [...history.networkTimestamps],
      networkRx: [...history.networkRx],
      networkTx: [...history.networkTx],
    },
  };
}

import si from "systeminformation";
import type {
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
const CACHE_TTL_MS = 2_000;
const COLLECTION_INTERVAL_MS = 5_000;
const IDLE_STOP_MS = 5 * 60 * 1_000; // stop background collection after 5min of no requests

// Ring buffer — only scalar series for sparklines
const history: SystemStatsHistory = {
  timestamps: [],
  cpu: [],
  memory: [],
  networkRx: [],
  networkTx: [],
};

let cachedStats: SystemStats | null = null;
let cacheTimestamp = 0;
let collectionTimer: ReturnType<typeof setInterval> | null = null;
let lastRequestTime = 0;

function pushToRingBuffer(stats: SystemStats) {
  const totalRx = stats.network.reduce((sum, n) => sum + n.rxSec, 0);
  const totalTx = stats.network.reduce((sum, n) => sum + n.txSec, 0);

  history.timestamps.push(stats.timestamp);
  history.cpu.push(stats.cpu.usage);
  history.memory.push(stats.memory.usagePercent);
  history.networkRx.push(totalRx);
  history.networkTx.push(totalTx);

  if (history.timestamps.length > RING_BUFFER_SIZE) {
    history.timestamps.shift();
    history.cpu.shift();
    history.memory.shift();
    history.networkRx.shift();
    history.networkTx.shift();
  }
}

async function collectStats(): Promise<SystemStats> {
  const [cpuLoad, cpuData, mem, disksRaw, networkRaw, processes, uptime, temp] =
    await Promise.all([
      si.currentLoad(),
      si.cpu(),
      si.mem(),
      si.fsSize(),
      si.networkStats(),
      si.processes(),
      si.time(),
      si.cpuTemperature().catch(() => null),
    ]);

  const cpu: CpuStats = {
    usage: Math.round(cpuLoad.currentLoad * 10) / 10,
    cores: cpuData.cores,
    model: `${cpuData.manufacturer} ${cpuData.brand}`.trim(),
    speed: cpuData.speed,
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

  return {
    cpu,
    memory,
    disks,
    network,
    processes: topProcesses,
    uptime: Math.floor(uptime.uptime),
    timestamp: Date.now(),
  };
}

function startCollection() {
  if (collectionTimer) return;
  collectionTimer = setInterval(async () => {
    // Auto-stop after idle period
    if (Date.now() - lastRequestTime > IDLE_STOP_MS) {
      stopCollection();
      return;
    }
    try {
      const stats = await collectStats();
      cachedStats = stats;
      cacheTimestamp = Date.now();
      pushToRingBuffer(stats);
    } catch {
      // silently swallow — transient collection errors shouldn't crash the server
    }
  }, COLLECTION_INTERVAL_MS);
}

function stopCollection() {
  if (collectionTimer) {
    clearInterval(collectionTimer);
    collectionTimer = null;
  }
}

export async function getSystemStats(): Promise<SystemStats> {
  lastRequestTime = Date.now();
  startCollection();

  if (cachedStats && Date.now() - cacheTimestamp < CACHE_TTL_MS) {
    return cachedStats;
  }

  const stats = await collectStats();
  cachedStats = stats;
  cacheTimestamp = Date.now();
  pushToRingBuffer(stats);
  return stats;
}

export async function getSystemStatsWithHistory(): Promise<SystemStatsWithHistory> {
  const current = await getSystemStats();
  return { current, history: { ...history } };
}

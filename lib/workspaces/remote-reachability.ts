import { connect } from "node:net";

const PROBE_TIMEOUT_MS = 3_000;
const CHECK_TTL_MS = 30_000;
// A refused connection still proves the host answers, so only these mean down.
const UNREACHABLE_ERROR_CODES = new Set([
  "EAI_AGAIN",
  "EHOSTDOWN",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENOTFOUND",
  "ETIMEDOUT",
]);

type HostCheck = {
  result: Promise<boolean>;
  checkedAt: number;
  isChecking: boolean;
};

declare global {
  var __devhubRemoteHostChecks: Map<string, HostCheck> | undefined;
}

function probePort(target: URL): number {
  if (target.port) return Number(target.port);
  return target.protocol === "https:" || target.protocol === "wss:" ? 443 : 80;
}

function probeHost(target: URL): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: target.hostname, port: probePort(target) });
    const finish = (isReachable: boolean): void => {
      socket.destroy();
      resolve(isReachable);
    };
    socket.setTimeout(PROBE_TIMEOUT_MS, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", (error: NodeJS.ErrnoException) =>
      finish(!UNREACHABLE_ERROR_CODES.has(error.code ?? "")),
    );
  });
}

// Only a host's first check makes callers wait. Later calls get the last
// answer at once while a check older than CHECK_TTL_MS refreshes behind them,
// so requests to a sleeping host fail fast instead of hanging until timeout.
export function isRemoteHostReachable(url: string): Promise<boolean> {
  const target = new URL(url);
  const checks = (globalThis.__devhubRemoteHostChecks ??= new Map());
  const existing = checks.get(target.hostname);
  if (existing === undefined) {
    const check: HostCheck = {
      result: probeHost(target),
      checkedAt: Date.now(),
      isChecking: true,
    };
    void check.result.then(() => {
      check.checkedAt = Date.now();
      check.isChecking = false;
    });
    checks.set(target.hostname, check);
    return check.result;
  }
  if (!existing.isChecking && Date.now() - existing.checkedAt >= CHECK_TTL_MS) {
    existing.isChecking = true;
    void probeHost(target).then((isReachable) => {
      existing.result = Promise.resolve(isReachable);
      existing.checkedAt = Date.now();
      existing.isChecking = false;
    });
  }
  return existing.result;
}

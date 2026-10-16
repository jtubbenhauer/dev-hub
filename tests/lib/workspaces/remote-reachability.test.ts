// @vitest-environment node
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isRemoteHostReachable } from "@/lib/workspaces/remote-reachability";

type FakeSocket = EventEmitter & {
  readonly options: { readonly host: string; readonly port: number };
  isDestroyed: boolean;
  timeout: (() => void) | undefined;
  setTimeout: (milliseconds: number, onTimeout: () => void) => void;
  destroy: () => void;
};

const { sockets } = vi.hoisted(() => ({ sockets: [] as FakeSocket[] }));

vi.mock("node:net", () => ({
  connect: (options: { readonly host: string; readonly port: number }) => {
    const socket: FakeSocket = Object.assign(new EventEmitter(), {
      options,
      isDestroyed: false,
      timeout: undefined,
      setTimeout: (_milliseconds: number, onTimeout: () => void) => {
        socket.timeout = onTimeout;
      },
      destroy: () => {
        socket.isDestroyed = true;
      },
    });
    sockets.push(socket);
    return socket;
  },
}));

function socketAt(index: number): FakeSocket {
  const socket = sockets[index];
  if (socket === undefined) throw new Error(`No probe socket ${index}`);
  return socket;
}

function refused(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code });
}

function settleBackgroundWork(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

beforeEach(() => {
  globalThis.__devhubRemoteHostChecks = undefined;
  sockets.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("isRemoteHostReachable", () => {
  it("reports a host reachable when a TCP connection to its port opens", async () => {
    const result = isRemoteHostReachable("http://dev-rig:10001/health");

    socketAt(0).emit("connect");

    await expect(result).resolves.toBe(true);
    expect(socketAt(0).options).toEqual({ host: "dev-rig", port: 10001 });
    expect(socketAt(0).isDestroyed).toBe(true);
  });

  it("probes the scheme's default port when the URL names none", async () => {
    const result = isRemoteHostReachable("https://agent.example");

    socketAt(0).emit("connect");

    await expect(result).resolves.toBe(true);
    expect(socketAt(0).options).toEqual({ host: "agent.example", port: 443 });
  });

  it("reports a host unreachable when the connection times out", async () => {
    const result = isRemoteHostReachable("http://dev-rig:10001");

    socketAt(0).timeout?.();

    await expect(result).resolves.toBe(false);
  });

  it("counts a refused connection as a reachable host but a missing route as down", async () => {
    const refusedHost = isRemoteHostReachable("http://up-host:10001");
    const missingRoute = isRemoteHostReachable("http://down-host:10001");

    socketAt(0).emit("error", refused("ECONNREFUSED"));
    socketAt(1).emit("error", refused("EHOSTUNREACH"));

    await expect(refusedHost).resolves.toBe(true);
    await expect(missingRoute).resolves.toBe(false);
  });

  it("shares one probe between concurrent first checks of a host, whatever the port", async () => {
    const first = isRemoteHostReachable("http://dev-rig:10001");
    const second = isRemoteHostReachable("http://dev-rig:10002");

    socketAt(0).timeout?.();

    await expect(Promise.all([first, second])).resolves.toEqual([false, false]);
    expect(sockets).toHaveLength(1);
  });

  it("answers from the last check without probing again for 30 seconds", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const first = isRemoteHostReachable("http://dev-rig:10001");
    socketAt(0).timeout?.();
    await first;
    await settleBackgroundWork();

    vi.setSystemTime(Date.now() + 29_999);

    await expect(isRemoteHostReachable("http://dev-rig:10001")).resolves.toBe(
      false,
    );
    expect(sockets).toHaveLength(1);
  });

  it("after 30 seconds answers with the last result at once and refreshes behind it", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const first = isRemoteHostReachable("http://dev-rig:10001");
    socketAt(0).timeout?.();
    await first;
    await settleBackgroundWork();
    vi.setSystemTime(Date.now() + 30_000);

    await expect(isRemoteHostReachable("http://dev-rig:10001")).resolves.toBe(
      false,
    );
    expect(sockets).toHaveLength(2);
    await expect(isRemoteHostReachable("http://dev-rig:10001")).resolves.toBe(
      false,
    );
    expect(sockets).toHaveLength(2);

    socketAt(1).emit("connect");
    await settleBackgroundWork();

    await expect(isRemoteHostReachable("http://dev-rig:10001")).resolves.toBe(
      true,
    );
    expect(sockets).toHaveLength(2);
  });
});

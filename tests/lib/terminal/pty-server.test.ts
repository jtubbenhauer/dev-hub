// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import { WebSocket } from "ws";
import {
  createPtyServer,
  type PtyServerHandle,
} from "@/lib/terminal/pty-server";
import {
  createTerminalToken,
  terminalSocketScope,
} from "@/lib/terminal/terminal-auth";
import {
  endPtySession,
  listPtySessions,
  setPtySessionPinned,
} from "@/lib/terminal/pty-admin-client";
import {
  getSession,
  trackForegroundCommands,
} from "@/lib/terminal/pty-sessions";
import {
  SESSION_ENDED_CLOSE_CODE,
  SESSION_REPLACED_CLOSE_CODE,
} from "@/lib/terminal/terminal-protocol";

const WAIT_TIMEOUT_MS = 5000;

let server: PtyServerHandle;
let port: number;

interface TestClient {
  ws: WebSocket;
  output: () => string;
  controlMessages: () => unknown[];
  waitForOutput: (text: string) => Promise<void>;
  closed: Promise<number>;
}

function connect(
  sessionId: string,
  options: {
    workspaceId?: string;
    token?: string | null;
    origin?: string;
    extraParams?: Record<string, string>;
  } = {},
): TestClient {
  const workspaceId = options.workspaceId ?? "ws-test";
  const token =
    options.token === undefined
      ? createTerminalToken(terminalSocketScope(workspaceId), 60_000)
      : options.token;
  const params = new URLSearchParams({
    workspaceId,
    sessionId,
    cols: "80",
    rows: "24",
    cwd: "/tmp",
    shellCommand: "/bin/sh",
    ...options.extraParams,
  });
  if (token) params.set("token", token);
  const ws = new WebSocket(`ws://127.0.0.1:${port}?${params.toString()}`, {
    headers: options.origin ? { Origin: options.origin } : {},
  });

  let output = "";
  const controlMessages: unknown[] = [];
  const outputWaiters: Array<{ text: string; resolve: () => void }> = [];
  ws.on("message", (data: Buffer, isBinary: boolean) => {
    if (!isBinary) {
      controlMessages.push(JSON.parse(data.toString("utf8")));
      return;
    }
    output += data.toString("utf8");
    for (const waiter of [...outputWaiters]) {
      if (output.includes(waiter.text)) {
        outputWaiters.splice(outputWaiters.indexOf(waiter), 1);
        waiter.resolve();
      }
    }
  });
  const closed = new Promise<number>((resolve) =>
    ws.on("close", (code) => resolve(code)),
  );

  return {
    ws,
    output: () => output,
    controlMessages: () => controlMessages,
    closed,
    waitForOutput: (text) =>
      new Promise<void>((resolve, reject) => {
        if (output.includes(text)) return resolve();
        const timer = setTimeout(
          () => reject(new Error(`Timed out waiting for "${text}"`)),
          WAIT_TIMEOUT_MS,
        );
        outputWaiters.push({
          text,
          resolve: () => {
            clearTimeout(timer);
            resolve();
          },
        });
      }),
  };
}

function typeInto(client: TestClient, text: string): void {
  client.ws.send(Buffer.from(text, "utf8"));
}

function opened(client: TestClient): Promise<void> {
  return new Promise((resolve) => client.ws.once("open", () => resolve()));
}

beforeAll(async () => {
  process.env.AUTH_SECRET = "pty-server-test-secret";
  process.env.SHELL = "/bin/sh";
  server = createPtyServer();
  await new Promise<void>((resolve) =>
    server.httpServer.listen(0, "127.0.0.1", () => resolve()),
  );
  port = (server.httpServer.address() as AddressInfo).port;
  process.env.PTY_SERVER_PORT = String(port);
});

afterAll(async () => {
  await server.close();
});

describe("PTY server auth", () => {
  it("rejects a connection without a token", async () => {
    const client = connect("no-token", { token: null });
    expect(await client.closed).toBe(1008);
    expect(client.controlMessages()).toEqual([
      expect.objectContaining({ type: "error", isFatal: true }),
    ]);
  });

  it("rejects a token issued for another workspace", async () => {
    const client = connect("wrong-scope", {
      token: createTerminalToken(terminalSocketScope("other"), 60_000),
    });
    expect(await client.closed).toBe(1008);
  });

  it("rejects a browser origin that is not dev-hub", async () => {
    const client = connect("evil-origin", {
      origin: "https://evil.example",
    });
    expect(await client.closed).toBe(1008);
  });

  it("rejects admin requests without a token", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/sessions`);
    expect(res.status).toBe(401);
  });
});

describe("PTY session replay", () => {
  it("restores earlier output when a client reattaches", async () => {
    const first = connect("replay");
    await opened(first);
    typeInto(first, "printf 'replay-%s\\n' marker\r");
    await first.waitForOutput("replay-marker");
    first.ws.close();
    await first.closed;

    const second = connect("replay");
    await second.waitForOutput("replay-marker");
    typeInto(second, "printf 'after-%s\\n' reattach\r");
    await second.waitForOutput("after-reattach");
    second.ws.close();
    await second.closed;
  });

  it("closes the older socket when the session is opened elsewhere", async () => {
    const first = connect("replaced");
    await opened(first);
    const second = connect("replaced");
    expect(await first.closed).toBe(SESSION_REPLACED_CLOSE_CODE);
    second.ws.close();
    await second.closed;
  });
});

describe("PTY session lifecycle", () => {
  it("lists, pins and ends sessions through the admin API", async () => {
    const client = connect("lifecycle");
    await opened(client);
    typeInto(client, "printf 'ready-%s\\n' ok\r");
    await client.waitForOutput("ready-ok");

    const listed = await listPtySessions();
    expect(listed).toContainEqual(
      expect.objectContaining({
        workspaceId: "ws-test",
        sessionId: "lifecycle",
        kind: "shell",
        isAttached: true,
        isPinned: false,
      }),
    );

    const pinned = await setPtySessionPinned("ws-test", "lifecycle", true);
    expect(pinned?.isPinned).toBe(true);

    expect(await endPtySession("ws-test", "lifecycle")).toBe(true);
    expect(await client.closed).toBe(SESSION_ENDED_CLOSE_CODE);
    expect(
      (await listPtySessions()).some((s) => s.sessionId === "lifecycle"),
    ).toBe(false);
    expect(await endPtySession("ws-test", "lifecycle")).toBe(false);
  });

  it("ends a detached session after its idle timeout unless pinned", async () => {
    const idleParams = { idleTimeoutMinutes: "0.001" };
    const unpinned = connect("idle-unpinned", { extraParams: idleParams });
    const pinned = connect("idle-pinned", { extraParams: idleParams });
    await Promise.all([opened(unpinned), opened(pinned)]);
    await setPtySessionPinned("ws-test", "idle-pinned", true);

    unpinned.ws.close();
    pinned.ws.close();
    await Promise.all([unpinned.closed, pinned.closed]);

    await vi.waitFor(
      () => expect(getSession("ws-test", "idle-unpinned")).toBeUndefined(),
      { timeout: WAIT_TIMEOUT_MS },
    );
    expect(getSession("ws-test", "idle-pinned")).toBeDefined();
    await endPtySession("ws-test", "idle-pinned");
  });
});

describe("PTY command tracking", () => {
  it("records the running command and when it finishes", async () => {
    const client = connect("tracking", { extraParams: { shellCommand: "" } });
    await opened(client);
    await vi.waitFor(
      () => {
        trackForegroundCommands();
        expect(
          getSession("ws-test", "tracking")?.shellProcessName,
        ).toBeTruthy();
      },
      { timeout: WAIT_TIMEOUT_MS, interval: 50 },
    );
    typeInto(client, "sleep 1\r");

    await vi.waitFor(
      () => {
        trackForegroundCommands();
        expect(getSession("ws-test", "tracking")?.runningCommand).toBe("sleep");
      },
      { timeout: WAIT_TIMEOUT_MS, interval: 50 },
    );
    await vi.waitFor(
      () => {
        trackForegroundCommands();
        expect(
          getSession("ws-test", "tracking")?.lastFinishedCommand?.name,
        ).toBe("sleep");
      },
      { timeout: WAIT_TIMEOUT_MS, interval: 50 },
    );
    expect(getSession("ws-test", "tracking")?.runningCommand).toBeNull();
    await endPtySession("ws-test", "tracking");
  }, 10_000);
});

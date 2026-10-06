// allow: SIZE_OK — One serialized child-ownership state machine; splitting handlers would obscure its identity invariants.
import {
  spawn,
  type ChildProcess,
  type SpawnOptions,
} from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { createInterface, type Interface } from "node:readline";
import {
  StreamMessageReader,
  StreamMessageWriter,
  type Disposable,
} from "vscode-jsonrpc/node";
import {
  buildLspWsUrl,
  isJsonRpcNotification,
  isJsonRpcRequest,
  isJsonRpcResponse,
  LSP_NO_CONNECTION_IDLE_MS,
  type JsonRpcMessage,
  type LspServerState,
  type LspStatusResponse,
} from "@/lib/lsp/types";

type ServerCommand = { readonly command: string; readonly args: string[] };
type Workspace = {
  readonly workspaceId: string;
  readonly workspacePath: string;
};
type ManagerOptions = {
  readonly resolveServerCommand?: () => ServerCommand;
  readonly noConnectionIdleMs?: number;
  readonly spawnImpl?: (
    command: string,
    args: string[],
    options: SpawnOptions,
  ) => ChildProcess;
};

function signal() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function waitFor(
  promise: Promise<void>,
  milliseconds: number,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      promise,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export class LspBusyError extends Error {
  constructor() {
    super("LSP is connected to another workspace");
    this.name = "LspBusyError";
  }
}

export class LspServerManager {
  state: LspServerState = "stopped";
  epoch = 0;
  workspaceId: string | null = null;
  workspacePath: string | null = null;
  error: string | null = null;
  hasConnection = false;
  private child: ChildProcess | null = null;
  private reader: StreamMessageReader | null = null;
  private writer: StreamMessageWriter | null = null;
  private readerSubscription: Disposable | null = null;
  private stderrLines: Interface | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  private transitionTail: Promise<void> = Promise.resolve();
  private stopPromise: Promise<void> | null = null;
  private isStopping = false;
  private connectionCounter = 0;
  private activeConnectionToken: number | null = null;
  private exited = signal();
  private shutdownResponse = signal();
  private readonly messageListeners = new Set<
    (message: JsonRpcMessage) => void
  >();
  private readonly exitListeners = new Set<() => void>();
  private readonly stoppingListeners = new Set<() => void>();
  private readonly spawnImpl;
  private readonly noConnectionIdleMs;

  constructor(private readonly options: ManagerOptions = {}) {
    this.spawnImpl = options.spawnImpl ?? spawn;
    this.noConnectionIdleMs =
      options.noConnectionIdleMs ?? LSP_NO_CONNECTION_IDLE_MS;
    process.once("exit", () => this.child?.kill("SIGKILL"));
  }

  get isShuttingDown(): boolean {
    // A queued stop counts too: it will take the current child down next.
    return this.isStopping || this.stopPromise !== null;
  }

  getStatus(workspaceId: string, port: number): LspStatusResponse {
    if (workspaceId !== this.workspaceId) {
      return {
        workspaceId,
        serverEpoch: null,
        state: "stopped",
        wsUrl: null,
        error: null,
      };
    }
    return {
      workspaceId,
      serverEpoch: this.epoch,
      state: this.state,
      wsUrl:
        this.state === "running" && !this.isShuttingDown
          ? buildLspWsUrl(port, workspaceId, this.epoch)
          : null,
      error: this.error,
    };
  }

  private enqueue(work: () => Promise<void>): Promise<void> {
    const run = this.transitionTail.then(() => work());
    this.transitionTail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  start(workspace: Workspace): Promise<void> {
    return this.enqueue(async () => {
      if (
        this.workspaceId === workspace.workspaceId &&
        (this.state === "starting" || this.state === "running")
      )
        return;
      if (this.workspaceId !== workspace.workspaceId && this.hasConnection)
        throw new LspBusyError();
      if (this.child) {
        await this.stopInline();
        if (this.child)
          throw new Error(
            `previous vtsls process (pid ${this.child.pid}) did not exit`,
          );
      }
      this.workspaceId = workspace.workspaceId;
      this.workspacePath = workspace.workspacePath;
      this.error = null;
      let command: ServerCommand;
      if (this.options.resolveServerCommand) {
        command = this.options.resolveServerCommand();
      } else {
        const scriptPath = path.resolve(
          process.cwd(),
          process.env.VTSLS_BIN_PATH ||
            "node_modules/@vtsls/language-server/bin/vtsls.js",
        );
        if (!existsSync(scriptPath)) {
          this.state = "error";
          this.error = `vtsls not found at ${scriptPath} — run pnpm install`;
          return;
        }
        command = { command: process.execPath, args: [scriptPath, "--stdio"] };
      }
      let ownChild: ChildProcess;
      try {
        ownChild = this.spawnImpl(command.command, command.args, {
          cwd: workspace.workspacePath,
          stdio: "pipe",
          env: process.env,
        });
      } catch (error) {
        if (!(error instanceof Error)) throw error;
        this.state = "error";
        this.error = error.message;
        return;
      }
      this.child = ownChild;
      this.epoch += 1;
      this.state = "starting";
      this.exited = signal();
      this.shutdownResponse = signal();
      await this.observeChild(ownChild);
    });
  }

  private observeChild(ownChild: ChildProcess): Promise<void> {
    return new Promise((resolve) => {
      let isStarting = true;
      const finishStart = () => {
        isStarting = false;
        clearTimeout(startTimer);
        resolve();
      };
      const startTimer = setTimeout(() => {
        if (ownChild !== this.child) return;
        this.state = "error";
        this.error = "vtsls did not start within 10s";
        this.isStopping = true;
        ownChild.kill("SIGKILL");
        finishStart();
      }, 10_000);
      ownChild.on("spawn", () => {
        if (ownChild !== this.child) return;
        if (!isStarting) return;
        this.state = "running";
        if (!this.hasConnection) {
          this.idleTimer = setTimeout(() => {
            this.stop().catch((error: unknown) =>
              console.warn("[lsp] idle stop failed", error),
            );
          }, this.noConnectionIdleMs);
        }
        finishStart();
      });
      ownChild.on("error", (error: Error) => {
        if (ownChild !== this.child) return;
        // A failed spawn has no process whose exit needs confirmation.
        if (isStarting && ownChild.pid === undefined) this.releaseChild();
        this.state = "error";
        this.error = error.message;
        finishStart();
      });
      ownChild.on(
        "exit",
        (code: number | null, exitSignal: NodeJS.Signals | null) => {
          if (ownChild !== this.child) return;
          const wasStopping = this.isStopping;
          this.exited.resolve();
          this.releaseChild();
          finishStart();
          if (wasStopping) return;
          this.state = "error";
          this.error = `vtsls exited (code ${code}, signal ${exitSignal})`;
          for (const listener of this.exitListeners) listener();
        },
      );
      if (ownChild.stdout && ownChild.stdin) {
        this.reader = new StreamMessageReader(ownChild.stdout);
        this.writer = new StreamMessageWriter(ownChild.stdin);
        this.readerSubscription = this.reader.listen((message) => {
          if (ownChild !== this.child) return;
          if (
            isJsonRpcResponse(message) &&
            typeof message.id === "string" &&
            message.id.startsWith("devhub-")
          ) {
            if (message.id === `devhub-shutdown-${this.epoch}`)
              this.shutdownResponse.resolve();
            return;
          }
          if (
            isJsonRpcRequest(message) ||
            isJsonRpcNotification(message) ||
            isJsonRpcResponse(message)
          ) {
            for (const listener of this.messageListeners) listener(message);
          }
        });
      }
      if (ownChild.stderr) {
        let lineCount = 0;
        this.stderrLines = createInterface({ input: ownChild.stderr });
        this.stderrLines.on("line", (line: string) => {
          if (ownChild !== this.child) return;
          if (lineCount++ < 200) console.warn("[lsp]", line);
        });
      }
    });
  }

  stop(): Promise<void> {
    if (this.stopPromise) return this.stopPromise;
    const run = this.enqueue(async () => {
      await this.stopInline();
      if (this.child)
        throw new Error(
          `vtsls (pid ${this.child.pid}) did not exit after SIGKILL`,
        );
    });
    this.stopPromise = run;
    const settled = () => {
      this.stopPromise = null;
    };
    void run.then(settled, settled);
    return run;
  }

  private async stopInline(): Promise<void> {
    const ownChild = this.child;
    this.clearIdleTimer();
    if (ownChild) {
      const exited = this.exited.promise;
      if (!this.isStopping) {
        this.isStopping = true;
        for (const listener of this.stoppingListeners) listener();
        this.write({
          jsonrpc: "2.0",
          id: `devhub-shutdown-${this.epoch}`,
          method: "shutdown",
        });
        await waitFor(
          Promise.race([this.shutdownResponse.promise, exited]),
          2_000,
        );
        if (this.child === ownChild) {
          this.write({ jsonrpc: "2.0", method: "exit" });
          await waitFor(exited, 2_000);
        }
        if (this.child === ownChild) {
          ownChild.kill("SIGTERM");
          await waitFor(exited, 3_000);
        }
      }
      if (this.child === ownChild) {
        ownChild.kill("SIGKILL");
        await waitFor(exited, 5_000);
      }
      if (this.child === ownChild) {
        this.state = "error";
        this.error = `vtsls (pid ${ownChild.pid}) did not exit after SIGKILL`;
        this.hasConnection = false;
        this.activeConnectionToken = null;
        return;
      }
    }
    this.state = "stopped";
    this.error = null;
    this.workspaceId = null;
    this.workspacePath = null;
    this.hasConnection = false;
    this.activeConnectionToken = null;
    this.isStopping = false;
  }

  failWithError(message: string): Promise<void> {
    return this.enqueue(async () => {
      await this.stopInline();
      this.state = "error";
      this.error = message;
    });
  }

  attachConnection(): number | null {
    if (this.hasConnection) return null;
    this.connectionCounter += 1;
    this.activeConnectionToken = this.connectionCounter;
    this.hasConnection = true;
    this.clearIdleTimer();
    return this.activeConnectionToken;
  }

  detachConnection(token: number): void {
    if (token !== this.activeConnectionToken) return;
    this.activeConnectionToken = null;
    this.hasConnection = false;
    this.stop().catch((error: unknown) =>
      console.warn("[lsp] stop after disconnect failed", error),
    );
  }

  sendToServer(message: JsonRpcMessage): void {
    if (this.state === "running" && !this.isStopping) this.write(message);
  }

  private write(message: JsonRpcMessage): void {
    const ownChild = this.child;
    void this.writer?.write(message).catch((error: unknown) => {
      if (ownChild !== this.child) return;
      console.warn("[lsp] write failed", error);
    });
  }

  onServerMessage(listener: (message: JsonRpcMessage) => void): () => void {
    this.messageListeners.add(listener);
    return () => {
      this.messageListeners.delete(listener);
    };
  }

  onServerExited(listener: () => void): () => void {
    this.exitListeners.add(listener);
    return () => {
      this.exitListeners.delete(listener);
    };
  }

  onStopping(listener: () => void): () => void {
    this.stoppingListeners.add(listener);
    return () => {
      this.stoppingListeners.delete(listener);
    };
  }

  private clearIdleTimer(): void {
    clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
  }

  private releaseChild(): void {
    this.child = null;
    this.readerSubscription?.dispose();
    this.readerSubscription = null;
    this.reader?.dispose();
    this.reader = null;
    this.writer?.dispose();
    this.writer = null;
    this.stderrLines?.close();
    this.stderrLines = null;
    this.clearIdleTimer();
    this.hasConnection = false;
    this.activeConnectionToken = null;
    this.isStopping = false;
  }
}

declare global {
  var __devhubLspServerManager: LspServerManager | undefined;
}

export function getLspServerManager(): LspServerManager {
  return (globalThis.__devhubLspServerManager ??= new LspServerManager());
}

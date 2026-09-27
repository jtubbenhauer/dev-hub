const HEALTH_INTERVAL_MS = 30_000;
const RECONNECT_STABLE_MS = 30_000;
const MAX_RECONNECT_DELAY_MS = 30_000;
const DEFAULT_IDLE_DISCONNECT_MS = 600_000;

export type OmoRpcClientState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "retrying"
  | "idle"
  | "closed";

type OmoRpcLifecycleCallbacks = {
  readonly reconnect: () => Promise<void>;
  readonly ping: () => Promise<void>;
  readonly forceReconnect: () => void;
  readonly disconnectIdle: () => void;
  readonly hasPendingRequests: () => boolean;
};

function readIdleDisconnectMs(): number {
  const configured = process.env["OMO_IDLE_DISCONNECT_MS"];
  if (configured === undefined) return DEFAULT_IDLE_DISCONNECT_MS;
  const milliseconds = Number(configured);
  return Number.isFinite(milliseconds) && milliseconds >= 0
    ? milliseconds
    : DEFAULT_IDLE_DISCONNECT_MS;
}

export class OmoRpcLifecycle {
  private readonly callbacks: OmoRpcLifecycleCallbacks;
  private readonly idleDisconnectMs = readIdleDisconnectMs();
  private stateValue: OmoRpcClientState = "disconnected";
  private externalActivityAt = Date.now();
  private subscriberCount = 0;
  private operationCount = 0;
  private reconnectAttempt = 0;
  private healthFailures = 0;
  private connectionGeneration = 0;
  private reconnectTimer: NodeJS.Timeout | undefined;
  private stableTimer: NodeJS.Timeout | undefined;
  private healthTimer: NodeJS.Timeout | undefined;
  private idleTimer: NodeJS.Timeout | undefined;

  constructor(callbacks: OmoRpcLifecycleCallbacks) {
    this.callbacks = callbacks;
  }

  get state(): OmoRpcClientState {
    return this.stateValue;
  }

  get inFlightOps(): number {
    return this.operationCount;
  }

  get isClosed(): boolean {
    return this.stateValue === "closed";
  }

  markConnecting(): void {
    if (this.stateValue !== "closed") this.stateValue = "connecting";
  }

  markConnectionFailed(): void {
    if (this.stateValue === "connecting") this.stateValue = "disconnected";
  }

  connected(): void {
    this.clearReconnectTimer();
    this.stopConnectedTimers();
    this.stateValue = "connected";
    this.healthFailures = 0;
    this.connectionGeneration += 1;
    this.idleTimer = setInterval(
      () => this.disconnectIfIdle(),
      HEALTH_INTERVAL_MS,
    );
    this.healthTimer = setInterval(
      () => this.runHealthCheck(),
      HEALTH_INTERVAL_MS,
    );
    this.stableTimer = setTimeout(() => {
      this.reconnectAttempt = 0;
    }, RECONNECT_STABLE_MS);
  }

  recordExternalActivity(): void {
    this.externalActivityAt = Date.now();
  }

  addSubscriber(): void {
    this.subscriberCount += 1;
  }

  removeSubscriber(): void {
    this.subscriberCount = Math.max(0, this.subscriberCount - 1);
  }

  beginOp(): void {
    this.operationCount += 1;
  }

  endOp(): void {
    this.operationCount = Math.max(0, this.operationCount - 1);
  }

  transportGone(reconnectImmediately: boolean): void {
    if (this.stateValue === "closed" || this.stateValue === "idle") return;
    this.connectionGeneration += 1;
    this.stopConnectedTimers();
    if (reconnectImmediately) {
      this.clearReconnectTimer();
      this.stateValue = "retrying";
      this.runReconnect();
      return;
    }
    this.scheduleReconnect();
  }

  close(): void {
    this.stateValue = "closed";
    this.connectionGeneration += 1;
    this.clearReconnectTimer();
    this.stopConnectedTimers();
  }

  private disconnectIfIdle(): void {
    if (
      this.stateValue !== "connected" ||
      this.subscriberCount !== 0 ||
      this.operationCount !== 0 ||
      this.callbacks.hasPendingRequests() ||
      Date.now() - this.externalActivityAt <= this.idleDisconnectMs
    ) {
      return;
    }

    this.stateValue = "idle";
    this.connectionGeneration += 1;
    this.stopConnectedTimers();
    this.callbacks.disconnectIdle();
  }

  private runHealthCheck(): void {
    if (this.stateValue !== "connected") return;
    const generation = this.connectionGeneration;
    void this.callbacks.ping().then(
      () => {
        if (
          generation === this.connectionGeneration &&
          this.stateValue === "connected"
        ) {
          this.healthFailures = 0;
        }
      },
      () => {
        if (
          generation !== this.connectionGeneration ||
          this.stateValue !== "connected"
        ) {
          return;
        }
        this.healthFailures += 1;
        if (this.healthFailures >= 3) this.callbacks.forceReconnect();
      },
    );
  }

  private scheduleReconnect(): void {
    this.clearReconnectTimer();
    this.stateValue = "retrying";
    const delayMs = this.nextReconnectDelay();
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.runReconnect();
    }, delayMs);
  }

  private runReconnect(): void {
    if (this.stateValue === "closed" || this.stateValue === "idle") return;
    this.stateValue = "connecting";
    void this.callbacks.reconnect().then(
      () => undefined,
      () => {
        if (this.stateValue === "closed" || this.stateValue === "idle") return;
        if (this.stateValue === "retrying" && this.reconnectTimer) return;
        this.scheduleReconnect();
      },
    );
  }

  private nextReconnectDelay(): number {
    this.reconnectAttempt += 1;
    const exponentialDelay = Math.min(
      1000 * 2 ** Math.min(this.reconnectAttempt - 1, 5),
      MAX_RECONNECT_DELAY_MS,
    );
    const jitteredDelay = exponentialDelay * (0.8 + Math.random() * 0.4);
    return Math.min(Math.round(jitteredDelay), MAX_RECONNECT_DELAY_MS);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer === undefined) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
  }

  private stopConnectedTimers(): void {
    if (this.stableTimer !== undefined) clearTimeout(this.stableTimer);
    if (this.healthTimer !== undefined) clearInterval(this.healthTimer);
    if (this.idleTimer !== undefined) clearInterval(this.idleTimer);
    this.stableTimer = undefined;
    this.healthTimer = undefined;
    this.idleTimer = undefined;
  }
}

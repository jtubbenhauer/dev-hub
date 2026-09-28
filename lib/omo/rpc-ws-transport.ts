import { Duplex } from "node:stream";
import WebSocket, { type RawData } from "ws";
import { OmoTransportGoneError } from "@/lib/omo/errors";
import type { Transport } from "@/lib/omo/rpc-transport";

type WebSocketTransportOptions = {
  readonly url: string;
  readonly token: string;
};

type WriteCallback = (error?: Error | null) => void;

class JsonlWebSocketDuplex extends Duplex {
  private writeBuffer = "";

  constructor(private readonly webSocket: WebSocket) {
    super();
    webSocket.on("message", this.handleMessage);
    webSocket.once("close", this.handleClose);
    webSocket.once("error", this.handleError);
  }

  override _read(): void {}

  override _write(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: WriteCallback,
  ): void {
    this.writeBuffer += chunk.toString("utf8");
    const frames: string[] = [];
    let newlineIndex = this.writeBuffer.indexOf("\n");
    while (newlineIndex !== -1) {
      const line = this.writeBuffer.slice(0, newlineIndex);
      frames.push(line.endsWith("\r") ? line.slice(0, -1) : line);
      this.writeBuffer = this.writeBuffer.slice(newlineIndex + 1);
      newlineIndex = this.writeBuffer.indexOf("\n");
    }
    this.sendFrames(frames, 0, callback);
  }

  override _final(callback: WriteCallback): void {
    const frames = this.writeBuffer.length > 0 ? [this.writeBuffer] : [];
    this.writeBuffer = "";
    this.sendFrames(frames, 0, (error) => {
      if (error) {
        callback(error);
        return;
      }
      this.webSocket.close();
      callback();
    });
  }

  override _destroy(error: Error | null, callback: WriteCallback): void {
    this.webSocket.off("message", this.handleMessage);
    this.webSocket.off("close", this.handleClose);
    this.webSocket.off("error", this.handleError);
    if (
      this.webSocket.readyState === WebSocket.CONNECTING ||
      this.webSocket.readyState === WebSocket.OPEN
    ) {
      this.webSocket.terminate();
    }
    callback(error);
  }

  private readonly handleMessage = (data: RawData, isBinary: boolean): void => {
    if (isBinary) {
      this.destroy(new TypeError("OmO RPC WebSocket sent a binary frame"));
      return;
    }
    this.push(`${data.toString()}\n`);
  };

  private readonly handleClose = (): void => {
    this.push(null);
  };

  private readonly handleError = (error: Error): void => {
    this.destroy(error);
  };

  private sendFrames(
    frames: readonly string[],
    index: number,
    callback: WriteCallback,
  ): void {
    const frame = frames[index];
    if (frame === undefined) {
      callback();
      return;
    }
    try {
      this.webSocket.send(frame, (error) => {
        if (error) {
          callback(error);
          return;
        }
        this.sendFrames(frames, index + 1, callback);
      });
    } catch (error) {
      callback(
        error instanceof Error
          ? error
          : new TypeError("OmO RPC WebSocket send failed"),
      );
    }
  }
}

export class WebSocketTransport implements Transport {
  readonly kind = "ws";
  private readonly url: string;
  private readonly token: string;

  constructor(options: WebSocketTransportOptions) {
    this.url = options.url;
    this.token = options.token;
  }

  connect(): Promise<Duplex> {
    const webSocket = new WebSocket(this.url, {
      headers: { Authorization: `Bearer ${this.token}` },
      perMessageDeflate: false,
    });
    return new Promise((resolve, reject) => {
      const cleanup = (): void => {
        webSocket.off("open", onOpen);
        webSocket.off("error", onError);
        webSocket.off("close", onClose);
      };
      const onOpen = (): void => {
        cleanup();
        resolve(new JsonlWebSocketDuplex(webSocket));
      };
      const onError = (error: Error): void => {
        cleanup();
        webSocket.terminate();
        reject(error);
      };
      const onClose = (): void => {
        cleanup();
        reject(new OmoTransportGoneError());
      };
      webSocket.once("open", onOpen);
      webSocket.once("error", onError);
      webSocket.once("close", onClose);
    });
  }
}

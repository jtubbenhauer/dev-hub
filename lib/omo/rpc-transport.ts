import { createConnection } from "node:net";
import type { Duplex } from "node:stream";

export type Transport = {
  readonly kind: "unix" | "ws";
  readonly connect: () => Promise<Duplex>;
};

export class UnixSocketTransport implements Transport {
  readonly kind = "unix";
  private readonly socketPath: string;

  constructor({ socketPath }: { readonly socketPath: string }) {
    this.socketPath = socketPath;
  }

  connect(): Promise<Duplex> {
    const socket = createConnection(this.socketPath);
    return new Promise((resolve, reject) => {
      const cleanup = (): void => {
        socket.off("connect", onConnect);
        socket.off("error", onError);
      };
      const onConnect = (): void => {
        cleanup();
        resolve(socket);
      };
      const onError = (error: Error): void => {
        cleanup();
        socket.destroy();
        reject(error);
      };
      socket.once("connect", onConnect);
      socket.once("error", onError);
    });
  }
}

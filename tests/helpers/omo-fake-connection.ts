import type { Socket } from "node:net";
import type { JsonlRecord } from "@/lib/omo/jsonl";

type RecordWaiter = {
  readonly count: number;
  readonly resolve: () => void;
};

export class FakeOmoConnection {
  private firstChunk = Buffer.alloc(0);
  private readonly receivedRecords: JsonlRecord[] = [];
  private readonly recordWaiters: RecordWaiter[] = [];
  private advertisedCapabilities: readonly string[] = [];

  constructor(readonly socket: Socket) {}

  get firstBytes(): Buffer {
    return Buffer.from(this.firstChunk);
  }

  get records(): readonly JsonlRecord[] {
    return this.receivedRecords;
  }

  captureChunk(chunk: Buffer): void {
    if (this.firstChunk.length === 0) this.firstChunk = Buffer.from(chunk);
  }

  captureRecord(record: JsonlRecord): void {
    this.receivedRecords.push(record);
    for (let index = this.recordWaiters.length - 1; index >= 0; index -= 1) {
      const waiter = this.recordWaiters[index];
      if (waiter && this.receivedRecords.length >= waiter.count) {
        this.recordWaiters.splice(index, 1);
        waiter.resolve();
      }
    }
  }

  waitForRecordCount(count: number): Promise<void> {
    if (this.receivedRecords.length >= count) return Promise.resolve();
    return new Promise((resolve) =>
      this.recordWaiters.push({ count, resolve }),
    );
  }

  setCapabilities(capabilities: readonly string[]): void {
    this.advertisedCapabilities = capabilities;
  }

  capabilities(): readonly string[] {
    return this.advertisedCapabilities;
  }
}

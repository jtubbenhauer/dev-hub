import type { JsonlRecord } from "@/lib/omo/jsonl";

const MAX_BUFFERED_RECORDS = 512;
const MAX_BUFFERED_BYTES = 1024 * 1024;

export class OmoAsyncMutex {
  private tail = Promise.resolve();

  async acquire(): Promise<() => void> {
    const previous = this.tail;
    let releaseNext: (() => void) | undefined;
    this.tail = new Promise<void>((resolve) => {
      releaseNext = resolve;
    });
    await previous;
    return () => releaseNext?.();
  }
}

type BufferedRecord = {
  readonly record: JsonlRecord;
  readonly bytes: number;
};

export class OmoRegistryRecordBuffer {
  private readonly records: BufferedRecord[] = [];
  private bytes = 0;
  overflowed = false;

  get size(): number {
    return this.records.length;
  }

  push(record: JsonlRecord): void {
    const serialized = JSON.stringify(record);
    const bytes = serialized === undefined ? 0 : Buffer.byteLength(serialized);
    this.records.push({ record, bytes });
    this.bytes += bytes;
    while (
      this.records.length > MAX_BUFFERED_RECORDS ||
      this.bytes > MAX_BUFFERED_BYTES
    ) {
      const oldest = this.records.shift();
      if (oldest === undefined) break;
      this.bytes -= oldest.bytes;
      this.overflowed = true;
    }
  }

  pushAll(records: readonly JsonlRecord[]): void {
    for (const record of records) this.push(record);
  }

  drain(): readonly JsonlRecord[] {
    const drained = this.records.map((entry) => entry.record);
    this.records.length = 0;
    this.bytes = 0;
    return drained;
  }

  clear(): void {
    this.records.length = 0;
    this.bytes = 0;
    this.overflowed = false;
  }
}

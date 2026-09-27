import type { JsonlRecord } from "@/lib/omo/jsonl";

const MAX_BUFFERED_RECORDS = 512;
const MAX_BUFFERED_BYTES = 1024 * 1024;

type BufferedRecord = {
  readonly sessionId: string;
  readonly record: JsonlRecord;
  readonly bytes: number;
};

export type BufferedSessionRecords = {
  readonly records: readonly JsonlRecord[];
  readonly overflowed: boolean;
};

export class OmoPreBindBuffer {
  private readonly bufferedRecords: BufferedRecord[] = [];
  private readonly overflowedSessionIds = new Set<string>();
  private bufferedBytes = 0;

  push(sessionId: string, record: JsonlRecord): void {
    const serialized = JSON.stringify(record);
    const bytes = serialized === undefined ? 0 : Buffer.byteLength(serialized);
    this.bufferedRecords.push({ sessionId, record, bytes });
    this.bufferedBytes += bytes;
    while (
      this.bufferedRecords.length > MAX_BUFFERED_RECORDS ||
      this.bufferedBytes > MAX_BUFFERED_BYTES
    ) {
      const oldest = this.bufferedRecords.shift();
      if (oldest === undefined) break;
      this.bufferedBytes -= oldest.bytes;
      this.overflowedSessionIds.add(oldest.sessionId);
    }
  }

  take(sessionId: string): BufferedSessionRecords {
    const matchingRecords: JsonlRecord[] = [];
    const retainedRecords: BufferedRecord[] = [];
    let retainedBytes = 0;
    for (const buffered of this.bufferedRecords) {
      if (buffered.sessionId === sessionId) {
        matchingRecords.push(buffered.record);
      } else {
        retainedRecords.push(buffered);
        retainedBytes += buffered.bytes;
      }
    }
    this.bufferedRecords.length = 0;
    this.bufferedRecords.push(...retainedRecords);
    this.bufferedBytes = retainedBytes;
    return {
      records: matchingRecords,
      overflowed: this.overflowedSessionIds.delete(sessionId),
    };
  }

  clear(): void {
    this.bufferedRecords.length = 0;
    this.bufferedBytes = 0;
    this.overflowedSessionIds.clear();
  }
}

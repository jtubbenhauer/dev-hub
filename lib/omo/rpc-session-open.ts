import {
  OmoIncompatibleHostError,
  OmoOpenInFlightError,
} from "@/lib/omo/errors";
import type { JsonlRecord } from "@/lib/omo/jsonl";
import {
  readOpenedSession,
  type OmoOpenedSession,
  type OmoRequestOptions,
  type OmoSessionBoundListener,
} from "@/lib/omo/rpc-protocol";
import { OmoPreBindBuffer } from "@/lib/omo/rpc-session-buffer";

type OmoRequest = (
  record: JsonlRecord,
  options?: OmoRequestOptions,
) => Promise<JsonlRecord>;

export class OmoSessionOpener {
  readonly preBindBuffer = new OmoPreBindBuffer();
  private isOpenInFlight = false;

  async open(
    params: JsonlRecord,
    onBound: OmoSessionBoundListener,
    request: OmoRequest,
  ): Promise<OmoOpenedSession> {
    if (this.isOpenInFlight) throw new OmoOpenInFlightError();
    this.isOpenInFlight = true;
    let opened: OmoOpenedSession | undefined;
    try {
      await request(
        { type: "open_session", ...params },
        {
          onResponse: (response) => {
            opened = readOpenedSession(response);
            const { records, overflowed } = this.preBindBuffer.take(
              opened.sessionId,
            );
            onBound(opened, records, overflowed);
          },
        },
      );
    } finally {
      this.isOpenInFlight = false;
    }
    if (opened === undefined) throw new OmoIncompatibleHostError(undefined);
    return opened;
  }

  clear(): void {
    this.preBindBuffer.clear();
  }
}

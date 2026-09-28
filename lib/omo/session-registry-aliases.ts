import { OmoAsyncMutex } from "@/lib/omo/session-registry-lock";
import type {
  OmoAttachAliases,
  OmoPendingAttach,
} from "@/lib/omo/session-registry-types";

export class OmoAttachCoordinator {
  readonly pending = new Map<string, OmoPendingAttach>();
  readonly openLock = new OmoAsyncMutex();

  register(
    key: string,
    entry: OmoPendingAttach,
    aliases: OmoAttachAliases,
  ): void {
    this.pending.set(key, entry);
    aliases.keys.add(key);
  }

  delete(aliases: OmoAttachAliases): void {
    for (const key of aliases.keys) {
      if (this.pending.get(key)?.token === aliases.token) {
        this.pending.delete(key);
      }
    }
  }

  pathKey(workspaceId: string, sessionPath: string): string {
    return `${workspaceId}:path:${sessionPath}`;
  }

  idKey(workspaceId: string, durableId: string): string {
    return `${workspaceId}:id:${durableId}`;
  }
}

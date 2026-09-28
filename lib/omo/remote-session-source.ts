import { OmoTransportGoneError } from "@/lib/omo/errors";
import { isTrustedAgentOrigin } from "@/lib/workspaces/agent-origin";
import { OmoNotFoundError, type SessionSource } from "@/lib/omo/session-source";
import type {
  OmoSessionOnDiskSummary,
  SessionEntry,
} from "@/lib/omo/sessions-on-disk";

const REQUEST_TIMEOUT_MS = 5_000;

type RemoteAgentSessionSourceOptions = {
  readonly sessionsUrl: string;
  readonly token: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isSessionSummary(value: unknown): value is OmoSessionOnDiskSummary {
  return (
    isRecord(value) &&
    typeof value["durableId"] === "string" &&
    typeof value["sessionPath"] === "string" &&
    (typeof value["forkedFrom"] === "string" || value["forkedFrom"] === null) &&
    typeof value["title"] === "string" &&
    isFiniteNumber(value["createdMs"]) &&
    isFiniteNumber(value["updatedMs"])
  );
}

function hasEntryBase(value: unknown): value is Record<string, unknown> & {
  readonly type: string;
  readonly id: string;
  readonly parentId: string | null;
  readonly timestamp: number;
} {
  return (
    isRecord(value) &&
    typeof value["type"] === "string" &&
    typeof value["id"] === "string" &&
    (typeof value["parentId"] === "string" || value["parentId"] === null) &&
    isFiniteNumber(value["timestamp"])
  );
}

function isSessionEntry(value: unknown): value is SessionEntry {
  if (!hasEntryBase(value)) return false;
  switch (value.type) {
    case "message":
      return (
        isRecord(value["message"]) &&
        typeof value["message"]["role"] === "string" &&
        "content" in value["message"]
      );
    case "model_change":
      return (
        typeof value["provider"] === "string" &&
        typeof value["modelId"] === "string"
      );
    case "thinking_level_change":
      return typeof value["thinkingLevel"] === "string";
    case "compaction":
      return (
        typeof value["summary"] === "string" &&
        typeof value["firstKeptEntryId"] === "string" &&
        isFiniteNumber(value["tokensBefore"])
      );
    case "branch_summary":
      return (
        (typeof value["fromId"] === "string" || value["fromId"] === null) &&
        typeof value["summary"] === "string"
      );
    case "custom":
      return typeof value["customType"] === "string";
    case "custom_message":
      return (
        typeof value["customType"] === "string" &&
        "content" in value &&
        typeof value["display"] === "boolean"
      );
    case "label":
      return (
        typeof value["targetId"] === "string" &&
        (value["label"] === undefined || typeof value["label"] === "string")
      );
    case "session_info":
      return typeof value["name"] === "string";
    default:
      return false;
  }
}

function sessionsBaseUrl(sessionsUrl: string): URL {
  return new URL(sessionsUrl.endsWith("/") ? sessionsUrl : `${sessionsUrl}/`);
}

export class RemoteAgentSessionSource implements SessionSource {
  private readonly sessionsUrl: string;
  private readonly token: string;

  constructor(options: RemoteAgentSessionSourceOptions) {
    this.sessionsUrl = options.sessionsUrl;
    this.token = options.token;
  }

  async list(): Promise<readonly OmoSessionOnDiskSummary[]> {
    const response = await this.request(this.sessionsUrl, "GET");
    const value = await this.readJson(response);
    if (!Array.isArray(value) || !value.every(isSessionSummary)) {
      throw new OmoTransportGoneError();
    }
    return value;
  }

  async readEntries(rawId: string): Promise<readonly SessionEntry[]> {
    const url = new URL(
      `${encodeURIComponent(rawId)}/entries`,
      sessionsBaseUrl(this.sessionsUrl),
    );
    const response = await this.request(url.toString(), "GET");
    if (response.status === 404) throw new OmoNotFoundError(rawId);
    const value = await this.readJson(response);
    if (!Array.isArray(value) || !value.every(isSessionEntry)) {
      throw new OmoTransportGoneError();
    }
    return value;
  }

  async remove(rawId: string): Promise<void> {
    const response = await this.request(this.sessionUrl(rawId), "DELETE");
    if (response.status === 404) throw new OmoNotFoundError(rawId);
    if (!response.ok) throw new OmoTransportGoneError();
  }

  async removeProbeSession(
    rawProbeId: string,
    _sessionFile: string | undefined,
  ): Promise<void> {
    const response = await this.request(this.sessionUrl(rawProbeId), "DELETE");
    if (response.status === 404) return;
    if (!response.ok) throw new OmoTransportGoneError();
  }

  async canonicalWorkspacePath(): Promise<string> {
    const realpathUrl = new URL(
      "../realpath",
      sessionsBaseUrl(this.sessionsUrl),
    );
    const response = await this.request(realpathUrl.toString(), "GET");
    const value = await this.readJson(response);
    if (!isRecord(value) || typeof value["path"] !== "string") {
      throw new OmoTransportGoneError();
    }
    return value["path"];
  }

  async authorizeSession(rawId: string): Promise<boolean> {
    const sessions = await this.list();
    return sessions.some((session) => session.durableId === rawId);
  }

  private sessionUrl(rawId: string): string {
    return new URL(
      encodeURIComponent(rawId),
      sessionsBaseUrl(this.sessionsUrl),
    ).toString();
  }

  private async request(
    url: string,
    method: "DELETE" | "GET",
  ): Promise<Response> {
    if (!isTrustedAgentOrigin(url)) throw new OmoTransportGoneError();
    let response: Response;
    try {
      response = await globalThis.fetch(url, {
        method,
        headers: { Authorization: `Bearer ${this.token}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new OmoTransportGoneError();
    }
    if (!response.ok && response.status !== 404) {
      throw new OmoTransportGoneError();
    }
    return response;
  }

  private async readJson(response: Response): Promise<unknown> {
    try {
      return await response.json();
    } catch {
      throw new OmoTransportGoneError();
    }
  }
}

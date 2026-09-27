import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildOmoAssistantMessage,
  buildOmoTextPart,
} from "@/lib/omo/adapter/shapes";
import { createJsonlDecoder, type JsonlRecord } from "@/lib/omo/jsonl";
import type { MessageWithParts, Session } from "@/lib/opencode/types";
import {
  _resetModuleCaches,
  useChatStore,
  type WorkspaceState,
} from "@/stores/chat-store";

export const WORKSPACE_ID = "ws-rekey";
export const SESSION_ID = "omo_durable-live";

export interface AnimationFrameQueue {
  readonly request: (callback: FrameRequestCallback) => number;
  readonly flush: () => number[];
}

export function createAnimationFrameQueue(): AnimationFrameQueue {
  let callbacks: FrameRequestCallback[] = [];
  return {
    request(callback): number {
      callbacks.push(callback);
      return callbacks.length;
    },
    flush(): number[] {
      const messageCounts: number[] = [];
      while (callbacks.length > 0) {
        const pending = callbacks;
        callbacks = [];
        for (const callback of pending) {
          callback(performance.now());
          const messages =
            useChatStore.getState().workspaceStates[WORKSPACE_ID]?.messages[
              SESSION_ID
            ] ?? [];
          messageCounts.push(messages.length);
        }
      }
      return messageCounts;
    },
  };
}

export function resetRekeyStore(): void {
  _resetModuleCaches();
  useChatStore.getState().clearStreamingPoll();
  useChatStore.setState({
    workspaceStates: { [WORKSPACE_ID]: workspace() },
    commands: [],
    messageAccessOrder: [],
    queuedMessages: new Map(),
    queuedWorkspaceIds: new Set(),
    activeWorkspaceId: WORKSPACE_ID,
    activeSessionId: SESSION_ID,
    streamingError: null,
    optimisticStreamingSessionId: null,
  });
}

export function dispatchEvent(event: object): void {
  useChatStore.getState().handleEvent({ ...event }, WORKSPACE_ID);
}

function session(): Session {
  return {
    id: SESSION_ID,
    projectID: WORKSPACE_ID,
    directory: "/workspace",
    title: "Live session",
    version: "omo",
    time: { created: 1, updated: 1 },
  };
}

export function workspace(
  messages: MessageWithParts[] = [],
): WorkspaceState {
  return {
    sessions: { [SESSION_ID]: session() },
    sessionsLoaded: true,
    messages: { [SESSION_ID]: messages },
    optimisticMessageIds: {},
    sessionStatuses: {},
    permissions: [],
    questions: [],
    todos: {},
    todoUpdatedAt: {},
    sessionAgents: {},
    sessionModels: {},
    sessionVariants: {},
    lastViewedAt: {},
    pinnedSessionIds: new Set(),
    sessionNotes: {},
  };
}

export function fixtureRecords(fileName: string): JsonlRecord[] {
  const records: JsonlRecord[] = [];
  const decoder = createJsonlDecoder((record) => records.push(record));
  decoder.write(
    readFileSync(join(process.cwd(), "tests/fixtures/omo", fileName), "utf8"),
  );
  decoder.end();
  return records;
}

export function userEchoRecords(): JsonlRecord[] {
  return [
    {
      type: "message_start",
      message: {
        role: "user",
        content: "$frontend inspect this",
        timestamp: 1,
      },
    },
    {
      type: "entry_appended",
      timestamp: 1,
      entry: {
        id: "entry-text-user-1",
        parentId: null,
        message: {
          role: "user",
          content: "$frontend inspect this",
          timestamp: 1,
        },
      },
    },
  ];
}

export function assistantMessage(
  id: string,
  text: string,
): MessageWithParts {
  const info = buildOmoAssistantMessage({
    id,
    sessionID: SESSION_ID,
    parentMessageID: "omo_user-entry",
    created: 2,
    modelID: "gpt-5.6-sol",
    providerID: "openai",
    cwd: "/workspace",
    usage: { input: 1, output: 1 },
  });
  return {
    info,
    parts: [
      buildOmoTextPart({
        id: `${id}_0`,
        sessionID: SESSION_ID,
        messageID: id,
        text,
      }),
    ],
  };
}

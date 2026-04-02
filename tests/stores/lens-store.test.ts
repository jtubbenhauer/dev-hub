import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useLensStore, _resetModuleCaches } from "@/stores/lens-store";
import type { Message, Part } from "@/lib/opencode/types";

function makeSession(id: string) {
  return {
    id,
    projectID: "proj-1",
    directory: "/dev-hub",
    title: "[lens]",
    version: "1",
    time: { created: 1000, updated: 2000 },
  };
}

function makeUserMessage(id: string, sessionID: string): Message {
  return {
    id,
    sessionID,
    role: "user" as const,
    time: { created: Date.now() },
    agent: "",
    model: { providerID: "", modelID: "" },
  } as Message;
}

function makeAssistantMessage(id: string, sessionID: string): Message {
  return {
    id,
    sessionID,
    role: "assistant" as const,
    time: { created: Date.now() },
    parentID: "",
    modelID: "",
    providerID: "",
    mode: "",
    path: { cwd: "", root: "" },
    cost: 0,
    tokens: {
      input: 0,
      output: 0,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
  } as Message;
}

function makePart(id: string, sessionID: string, messageID: string): Part {
  return {
    id,
    sessionID,
    messageID,
    type: "text" as const,
    text: "hello",
  } as Part;
}

function resetStore() {
  _resetModuleCaches();
  useLensStore.setState({
    status: "uninitialized",
    sessionId: null,
    messages: [],
    streamingStatus: "idle",
    streamingError: null,
    eventSource: null,
    reconnectAttempts: 0,
    reconnectTimer: null,
  });
}

const fetchSpy = vi.fn();
globalThis.fetch = fetchSpy;

describe("lens-store", () => {
  beforeEach(() => {
    resetStore();
    fetchSpy.mockReset();
  });

  afterEach(() => {
    useLensStore.getState().disconnectSSE();
  });

  describe("initialize", () => {
    it("fetches existing session on GET", async () => {
      const session = makeSession("orch-1");
      fetchSpy
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(session),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve([]),
        });

      await useLensStore.getState().initialize();

      const state = useLensStore.getState();
      expect(state.status).toBe("ready");
      expect(state.sessionId).toBe("orch-1");
      expect(fetchSpy).toHaveBeenCalledWith("/api/lens/session");
    });

    it("creates session via POST when GET returns null", async () => {
      const session = makeSession("orch-2");
      fetchSpy
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(null),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(session),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve([]),
        });

      await useLensStore.getState().initialize();

      const state = useLensStore.getState();
      expect(state.status).toBe("ready");
      expect(state.sessionId).toBe("orch-2");
      expect(fetchSpy).toHaveBeenCalledWith("/api/lens/session", {
        method: "POST",
      });
    });

    it("sets error status when session GET fails", async () => {
      fetchSpy.mockResolvedValueOnce({ ok: false, status: 500 });

      await useLensStore.getState().initialize();

      const state = useLensStore.getState();
      expect(state.status).toBe("error");
      expect(state.streamingError).toBeTruthy();
    });

    it("skips if already initializing or ready", async () => {
      useLensStore.setState({ status: "ready", sessionId: "orch-1" });

      await useLensStore.getState().initialize();

      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe("sendMessage", () => {
    it("sends prompt via POST and sets streaming status", async () => {
      useLensStore.setState({
        status: "ready",
        sessionId: "orch-1",
      });
      fetchSpy.mockResolvedValueOnce({ ok: true, status: 204 });

      await useLensStore.getState().sendMessage("What am I working on?");

      expect(fetchSpy).toHaveBeenCalledWith("/api/lens/prompt", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionId: "orch-1",
          text: "What am I working on?",
        }),
      });
      expect(useLensStore.getState().streamingStatus).toBe("streaming");
    });

    it("does nothing when not ready", async () => {
      useLensStore.setState({ status: "uninitialized" });

      await useLensStore.getState().sendMessage("test");

      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("sets error status on prompt failure", async () => {
      useLensStore.setState({
        status: "ready",
        sessionId: "orch-1",
      });
      fetchSpy.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: () => Promise.resolve("Internal error"),
      });

      await useLensStore.getState().sendMessage("test");

      expect(useLensStore.getState().streamingStatus).toBe("error");
      expect(useLensStore.getState().streamingError).toBeTruthy();
    });
  });

  describe("fetchMessages", () => {
    it("fetches and populates messages", async () => {
      const msg = makeUserMessage("msg-1", "orch-1");
      useLensStore.setState({ sessionId: "orch-1" });
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([{ info: msg, parts: [] }]),
      });

      await useLensStore.getState().fetchMessages();

      expect(useLensStore.getState().messages).toHaveLength(1);
      expect(useLensStore.getState().messages[0].info.id).toBe("msg-1");
    });

    it("does nothing without a session ID", async () => {
      await useLensStore.getState().fetchMessages();

      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe("handleEvent", () => {
    beforeEach(() => {
      useLensStore.setState({ sessionId: "orch-1", messages: [] });
    });

    it("adds new message on message.updated", () => {
      const info = makeAssistantMessage("msg-1", "orch-1");
      useLensStore.getState().handleEvent({
        type: "message.updated",
        properties: { info },
      });

      const { messages } = useLensStore.getState();
      expect(messages).toHaveLength(1);
      expect(messages[0].info.id).toBe("msg-1");
      expect(messages[0].parts).toEqual([]);
    });

    it("updates existing message on message.updated", () => {
      const info = makeAssistantMessage("msg-1", "orch-1");
      useLensStore.setState({
        sessionId: "orch-1",
        messages: [{ info, parts: [] }],
      });

      const updatedInfo = { ...info, role: "assistant" as const };
      useLensStore.getState().handleEvent({
        type: "message.updated",
        properties: { info: updatedInfo },
      });

      expect(useLensStore.getState().messages).toHaveLength(1);
    });

    it("ignores message.updated for other sessions", () => {
      const info = makeAssistantMessage("msg-1", "other-session");
      useLensStore.getState().handleEvent({
        type: "message.updated",
        properties: { info },
      });

      expect(useLensStore.getState().messages).toHaveLength(0);
    });

    it("adds new part on message.part.updated", () => {
      const info = makeAssistantMessage("msg-1", "orch-1");
      useLensStore.setState({
        sessionId: "orch-1",
        messages: [{ info, parts: [] }],
      });

      const part = makePart("part-1", "orch-1", "msg-1");
      useLensStore.getState().handleEvent({
        type: "message.part.updated",
        properties: { part },
      });

      const { messages } = useLensStore.getState();
      expect(messages[0].parts).toHaveLength(1);
      expect(messages[0].parts[0].id).toBe("part-1");
    });

    it("updates existing part on message.part.updated", () => {
      const info = makeAssistantMessage("msg-1", "orch-1");
      const part = makePart("part-1", "orch-1", "msg-1");
      useLensStore.setState({
        sessionId: "orch-1",
        messages: [{ info, parts: [part] }],
      });

      const updatedPart = { ...part, text: "updated text" } as Part;
      useLensStore.getState().handleEvent({
        type: "message.part.updated",
        properties: { part: updatedPart },
      });

      const { messages } = useLensStore.getState();
      expect(messages[0].parts).toHaveLength(1);
      expect((messages[0].parts[0] as { text: string }).text).toBe(
        "updated text",
      );
    });

    it("removes part on message.part.removed", () => {
      const info = makeAssistantMessage("msg-1", "orch-1");
      const part = makePart("part-1", "orch-1", "msg-1");
      useLensStore.setState({
        sessionId: "orch-1",
        messages: [{ info, parts: [part] }],
      });

      useLensStore.getState().handleEvent({
        type: "message.part.removed",
        properties: {
          sessionID: "orch-1",
          messageID: "msg-1",
          partID: "part-1",
        },
      });

      expect(useLensStore.getState().messages[0].parts).toHaveLength(0);
    });

    it("removes message on message.removed", () => {
      const info = makeAssistantMessage("msg-1", "orch-1");
      useLensStore.setState({
        sessionId: "orch-1",
        messages: [{ info, parts: [] }],
      });

      useLensStore.getState().handleEvent({
        type: "message.removed",
        properties: { sessionID: "orch-1", messageID: "msg-1" },
      });

      expect(useLensStore.getState().messages).toHaveLength(0);
    });

    it("sets streaming idle on session.status idle", () => {
      useLensStore.setState({ streamingStatus: "streaming" });

      useLensStore.getState().handleEvent({
        type: "session.status",
        properties: {
          sessionID: "orch-1",
          status: { type: "idle" },
        },
      });

      expect(useLensStore.getState().streamingStatus).toBe("idle");
    });

    it("sets streaming on session.status non-idle", () => {
      useLensStore.getState().handleEvent({
        type: "session.status",
        properties: {
          sessionID: "orch-1",
          status: { type: "busy" },
        },
      });

      expect(useLensStore.getState().streamingStatus).toBe("streaming");
    });

    it("sets streaming idle on session.idle", () => {
      useLensStore.setState({ streamingStatus: "streaming" });

      useLensStore.getState().handleEvent({
        type: "session.idle",
        properties: { sessionID: "orch-1" },
      });

      expect(useLensStore.getState().streamingStatus).toBe("idle");
    });

    it("sets error on session.error", () => {
      useLensStore.getState().handleEvent({
        type: "session.error",
        properties: {
          sessionID: "orch-1",
          error: { data: { message: "Something broke" } },
        },
      });

      expect(useLensStore.getState().streamingStatus).toBe("error");
      expect(useLensStore.getState().streamingError).toBe("Something broke");
    });

    it("ignores events without properties", () => {
      useLensStore.getState().handleEvent({
        type: "message.updated",
      });

      expect(useLensStore.getState().messages).toHaveLength(0);
    });
  });

  describe("connectSSE / disconnectSSE", () => {
    it("creates an EventSource on connect", () => {
      useLensStore.getState().connectSSE();

      const { eventSource } = useLensStore.getState();
      expect(eventSource).toBeTruthy();
      expect((eventSource as { url: string }).url).toBe("/api/lens/events");
    });

    it("closes EventSource on disconnect", () => {
      useLensStore.getState().connectSSE();
      const { eventSource } = useLensStore.getState();

      useLensStore.getState().disconnectSSE();

      expect((eventSource as { readyState: number }).readyState).toBe(
        EventSource.CLOSED,
      );
      expect(useLensStore.getState().eventSource).toBeNull();
    });

    it("does not create duplicate connections", () => {
      useLensStore.getState().connectSSE();
      const first = useLensStore.getState().eventSource;

      // Simulate open state
      (first as { readyState: number }).readyState = EventSource.OPEN;

      useLensStore.getState().connectSSE();
      const second = useLensStore.getState().eventSource;

      expect(first).toBe(second);
    });
  });

  describe("reset", () => {
    it("disconnects SSE and resets all state", () => {
      useLensStore.setState({
        status: "ready",
        sessionId: "orch-1",
        streamingStatus: "streaming",
        streamingError: "some error",
        messages: [{ info: makeUserMessage("m1", "orch-1"), parts: [] }],
      });

      useLensStore.getState().reset();

      const state = useLensStore.getState();
      expect(state.status).toBe("uninitialized");
      expect(state.sessionId).toBeNull();
      expect(state.messages).toHaveLength(0);
      expect(state.streamingStatus).toBe("idle");
      expect(state.streamingError).toBeNull();
    });
  });

  describe("RAF batching", () => {
    beforeEach(() => {
      useLensStore.setState({ sessionId: "orch-1", messages: [] });
    });

    it("batches multiple message.updated events into one state update", () => {
      const msg1 = makeAssistantMessage("msg-1", "orch-1");
      const msg2 = makeAssistantMessage("msg-2", "orch-1");

      // The RAF shim in tests/setup.ts runs callbacks synchronously,
      // so each handleEvent triggers an immediate flush.
      useLensStore.getState().handleEvent({
        type: "message.updated",
        properties: { info: msg1 },
      });
      useLensStore.getState().handleEvent({
        type: "message.updated",
        properties: { info: msg2 },
      });

      const { messages } = useLensStore.getState();
      expect(messages).toHaveLength(2);
      expect(messages[0].info.id).toBe("msg-1");
      expect(messages[1].info.id).toBe("msg-2");
    });

    it("batches multiple part updates for the same message", () => {
      const info = makeAssistantMessage("msg-1", "orch-1");
      useLensStore.setState({
        sessionId: "orch-1",
        messages: [{ info, parts: [] }],
      });

      const part1 = makePart("part-1", "orch-1", "msg-1");
      const part2 = makePart("part-2", "orch-1", "msg-1");

      useLensStore.getState().handleEvent({
        type: "message.part.updated",
        properties: { part: part1 },
      });
      useLensStore.getState().handleEvent({
        type: "message.part.updated",
        properties: { part: part2 },
      });

      const { messages } = useLensStore.getState();
      expect(messages[0].parts).toHaveLength(2);
      expect(messages[0].parts[0].id).toBe("part-1");
      expect(messages[0].parts[1].id).toBe("part-2");
    });

    it("does not mutate the original messages array", () => {
      const info = makeAssistantMessage("msg-1", "orch-1");
      const original = [{ info, parts: [] as Part[] }];
      useLensStore.setState({
        sessionId: "orch-1",
        messages: original,
      });

      const part = makePart("part-1", "orch-1", "msg-1");
      useLensStore.getState().handleEvent({
        type: "message.part.updated",
        properties: { part },
      });

      // Original array should be untouched — flush creates a new array
      expect(original[0].parts).toHaveLength(0);
      expect(useLensStore.getState().messages).not.toBe(original);
    });

    it("_resetModuleCaches clears pending buffers", () => {
      // Temporarily override rAF to NOT flush synchronously
      const originalRaf = globalThis.requestAnimationFrame;
      globalThis.requestAnimationFrame = (() =>
        999) as typeof requestAnimationFrame;

      try {
        const info = makeAssistantMessage("msg-1", "orch-1");
        useLensStore.getState().handleEvent({
          type: "message.updated",
          properties: { info },
        });

        // Event was buffered but not flushed
        expect(useLensStore.getState().messages).toHaveLength(0);

        _resetModuleCaches();

        // Restore real rAF — any future flushes should find empty buffers
        globalThis.requestAnimationFrame = originalRaf;

        // Messages should still be empty since we cleared the buffers
        expect(useLensStore.getState().messages).toHaveLength(0);
      } finally {
        globalThis.requestAnimationFrame = originalRaf;
      }
    });
  });
});

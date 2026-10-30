import {
  evaluateSessionTreeSettle,
  findRootSessionId,
  type SessionTreeSnapshot,
} from "@/lib/attention/session-tree";
import type {
  PermissionRequest,
  QuestionRequest,
  Session,
  SessionStatus,
} from "@/lib/opencode/types";
import { describe, expect, it } from "vitest";

function makeSession(id: string, parentID?: string): Session {
  return {
    id,
    projectID: "proj-1",
    directory: "/workspace",
    title: `Session ${id}`,
    version: "1",
    parentID,
    time: { created: 1000, updated: 1000 },
  };
}

function makePermission(id: string, sessionID: string): PermissionRequest {
  return {
    id,
    sessionID,
    permission: "edit",
    patterns: [],
    metadata: {},
    always: [],
  };
}

function makeQuestion(id: string, sessionID: string): QuestionRequest {
  return { id, sessionID, questions: [] };
}

const treeSessions: Readonly<Record<string, Session>> = {
  root: makeSession("root"),
  child: makeSession("child", "root"),
  grandchild: makeSession("grandchild", "child"),
  unrelated: makeSession("unrelated"),
};

function makeTree(
  overrides: Partial<SessionTreeSnapshot> = {},
): SessionTreeSnapshot {
  return {
    sessions: treeSessions,
    statuses: {},
    permissions: [],
    questions: [],
    ...overrides,
  };
}

const idle: SessionStatus = { type: "idle" };
const busy: SessionStatus = { type: "busy" };

describe("findRootSessionId", () => {
  it("returns the session itself when it is a root", () => {
    expect(findRootSessionId(treeSessions, "root")).toBe("root");
  });

  it("returns the top session of a 3-level chain", () => {
    expect(findRootSessionId(treeSessions, "grandchild")).toBe("root");
  });

  it("returns the missing parent id when the parent is not loaded", () => {
    const sessions = { orphan: makeSession("orphan", "not-loaded") };

    expect(findRootSessionId(sessions, "orphan")).toBe("not-loaded");
  });

  it("terminates on a parent cycle", () => {
    const sessions = {
      a: makeSession("a", "b"),
      b: makeSession("b", "a"),
    };

    expect(findRootSessionId(sessions, "a")).toBe("b");
  });

  it("treats an empty parentID as a root", () => {
    const sessions = { blank: makeSession("blank", "") };

    expect(findRootSessionId(sessions, "blank")).toBe("blank");
  });

  it("returns an unknown session id unchanged", () => {
    expect(findRootSessionId(treeSessions, "ghost")).toBe("ghost");
  });

  it("stops after 50 hops on a very deep chain", () => {
    const sessions: Record<string, Session> = {};
    for (let level = 0; level < 60; level += 1) {
      sessions[`s${level}`] = makeSession(
        `s${level}`,
        level === 59 ? undefined : `s${level + 1}`,
      );
    }

    expect(findRootSessionId(sessions, "s0")).toBe("s50");
  });
});

describe("evaluateSessionTreeSettle", () => {
  it("is settled when the root and all descendants are idle", () => {
    const tree = makeTree({
      statuses: { root: idle, child: idle, grandchild: idle },
    });

    expect(evaluateSessionTreeSettle(tree, "root")).toEqual({
      isSettled: true,
      isRootIdle: true,
      hasPendingPrompt: false,
      busyDescendantIds: [],
    });
  });

  it("is not settled while a child is busy and lists it as busy", () => {
    const tree = makeTree({ statuses: { root: idle, child: busy } });

    expect(evaluateSessionTreeSettle(tree, "root")).toEqual({
      isSettled: false,
      isRootIdle: true,
      hasPendingPrompt: false,
      busyDescendantIds: ["child"],
    });
  });

  it("is not settled while a grandchild has a pending permission", () => {
    const tree = makeTree({
      statuses: { root: idle, child: idle, grandchild: idle },
      permissions: [makePermission("perm-1", "grandchild")],
    });

    expect(evaluateSessionTreeSettle(tree, "root")).toEqual({
      isSettled: false,
      isRootIdle: true,
      hasPendingPrompt: true,
      busyDescendantIds: [],
    });
  });

  it("is not settled while the root itself has a pending question", () => {
    const tree = makeTree({
      statuses: { root: idle },
      questions: [makeQuestion("question-1", "root")],
    });

    const result = evaluateSessionTreeSettle(tree, "root");

    expect(result.isSettled).toBe(false);
    expect(result.hasPendingPrompt).toBe(true);
  });

  it("is not settled while the root itself has a pending permission", () => {
    const tree = makeTree({
      permissions: [makePermission("perm-root", "root")],
    });

    expect(evaluateSessionTreeSettle(tree, "root").hasPendingPrompt).toBe(true);
  });

  it("is not settled while the root is busy", () => {
    const tree = makeTree({ statuses: { root: busy } });

    expect(evaluateSessionTreeSettle(tree, "root")).toEqual({
      isSettled: false,
      isRootIdle: false,
      hasPendingPrompt: false,
      busyDescendantIds: [],
    });
  });

  it("counts a root without a status entry as idle", () => {
    const tree = makeTree({ statuses: {} });

    expect(evaluateSessionTreeSettle(tree, "root")).toEqual({
      isSettled: true,
      isRootIdle: true,
      hasPendingPrompt: false,
      busyDescendantIds: [],
    });
  });

  it("ignores activity in unrelated trees", () => {
    const tree = makeTree({
      statuses: { unrelated: busy },
      questions: [makeQuestion("question-2", "unrelated")],
    });

    expect(evaluateSessionTreeSettle(tree, "root").isSettled).toBe(true);
  });
});

// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  chooseRequestEngine,
  type EngineRequest,
  type RequestEngineChoice,
} from "@/lib/engine/request-engine";
import { canWorkspaceRunEngine } from "@/lib/engine/workspace-engines";

function choose(
  method: string,
  path: string,
  engineParam: string | null = null,
): RequestEngineChoice {
  const request: EngineRequest = {
    method,
    pathSegments: path.split("/").filter(Boolean),
    engineParam,
  };
  return chooseRequestEngine(request);
}

describe("chooseRequestEngine", () => {
  it.each([
    { method: "GET", path: "session/omo_abc/message", engine: "omo" },
    { method: "POST", path: "session/omo_abc/prompt_async", engine: "omo" },
    { method: "DELETE", path: "session/ses_abc", engine: "opencode" },
    {
      method: "POST",
      path: "session/ses_abc/permissions/per_1",
      engine: "opencode",
    },
    { method: "POST", path: "question/dh_q_1/reply", engine: "omo" },
    { method: "POST", path: "question/que_1/reject", engine: "opencode" },
    { method: "POST", path: "permission/dh_p_1/reply", engine: "omo" },
    { method: "GET", path: "session/identities", engine: "omo" },
  ])("sends $method /$path to $engine", ({ method, path, engine }) => {
    expect(choose(method, path)).toEqual({ kind: "engine", engine });
  });

  it("lets the session id win over the engine param", () => {
    expect(choose("GET", "session/omo_abc", "opencode")).toEqual({
      kind: "engine",
      engine: "omo",
    });
  });

  it.each([
    { method: "POST", path: "session", engineParam: "omo" },
    { method: "GET", path: "command", engineParam: "opencode" },
    { method: "GET", path: "session", engineParam: "omo" },
  ])(
    "uses the engine param for $method /$path",
    ({ method, path, engineParam }) => {
      expect(choose(method, path, engineParam)).toEqual({
        kind: "engine",
        engine: engineParam,
      });
    },
  );

  it.each([
    { path: "session", shape: "list" },
    { path: "permission", shape: "list" },
    { path: "question", shape: "list" },
    { path: "session/status", shape: "record" },
  ])("merges GET /$path from both engines", ({ path, shape }) => {
    expect(choose("GET", path)).toEqual({ kind: "merged", shape });
  });

  it.each([
    { method: "POST", path: "session" },
    { method: "GET", path: "command" },
    { method: "GET", path: "config/providers" },
    { method: "GET", path: "global/health" },
    { method: "POST", path: "session", engineParam: "neither" },
  ])(
    "falls back to the workspace default for $method /$path",
    ({ method, path, engineParam }) => {
      expect(choose(method, path, engineParam ?? null)).toEqual({
        kind: "workspace-default",
      });
    },
  );
});

describe("canWorkspaceRunEngine", () => {
  it("lets a local workspace use both engines", () => {
    const local = {
      backend: "local",
      opencodeUrl: null,
      agentUrl: null,
    } as const;
    expect(canWorkspaceRunEngine(local, "opencode")).toBe(true);
    expect(canWorkspaceRunEngine(local, "omo")).toBe(true);
  });

  it("needs an OpenCode URL and a trusted agent for a remote workspace", () => {
    const remote = {
      backend: "remote",
      opencodeUrl: "http://127.0.0.1:4096",
      agentUrl: "http://127.0.0.1:7500",
    } as const;
    expect(canWorkspaceRunEngine(remote, "opencode")).toBe(true);
    expect(canWorkspaceRunEngine(remote, "omo")).toBe(true);
    expect(
      canWorkspaceRunEngine({ ...remote, opencodeUrl: null }, "opencode"),
    ).toBe(false);
    expect(canWorkspaceRunEngine({ ...remote, agentUrl: null }, "omo")).toBe(
      false,
    );
    expect(
      canWorkspaceRunEngine({ ...remote, agentUrl: null }, "opencode"),
    ).toBe(false);
    expect(
      canWorkspaceRunEngine(
        { ...remote, agentUrl: "http://agent.example.com:7500" },
        "omo",
      ),
    ).toBe(false);
  });
});

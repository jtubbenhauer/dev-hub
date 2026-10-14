import {
  engineForSessionId,
  isChatEngine,
  type ChatEngine,
} from "@/lib/engine/types";

export type RequestEngineChoice =
  | { readonly kind: "engine"; readonly engine: ChatEngine }
  | { readonly kind: "workspace-default" }
  | { readonly kind: "merged"; readonly shape: "list" | "record" };

export interface EngineRequest {
  readonly method: string;
  readonly pathSegments: readonly string[];
  readonly engineParam: string | null;
}

const WORKSPACE_LIST_RESOURCES = new Set(["session", "permission", "question"]);
const SESSION_COLLECTION_ROUTES = new Set(["status", "identities"]);

function engineForPromptId(promptId: string, omoPrefix: string): ChatEngine {
  return promptId.startsWith(omoPrefix) ? "omo" : "opencode";
}

// A request about one session (or one pending prompt) goes to the engine that
// owns it. Workspace-wide reads of sessions, statuses and pending prompts are
// answered by both engines, because one workspace can hold chats of both.
export function chooseRequestEngine(
  request: EngineRequest,
): RequestEngineChoice {
  const [resource, id] = request.pathSegments;
  if (
    resource === "session" &&
    id !== undefined &&
    !SESSION_COLLECTION_ROUTES.has(id)
  ) {
    return { kind: "engine", engine: engineForSessionId(id) };
  }
  if (resource === "question" && id !== undefined) {
    return { kind: "engine", engine: engineForPromptId(id, "dh_q_") };
  }
  if (resource === "permission" && id !== undefined) {
    return { kind: "engine", engine: engineForPromptId(id, "dh_p_") };
  }
  if (isChatEngine(request.engineParam)) {
    return { kind: "engine", engine: request.engineParam };
  }
  if (resource === "session" && id === "identities") {
    return { kind: "engine", engine: "omo" };
  }
  if (request.method === "GET" && resource !== undefined) {
    if (
      request.pathSegments.length === 1 &&
      WORKSPACE_LIST_RESOURCES.has(resource)
    ) {
      return { kind: "merged", shape: "list" };
    }
    if (
      request.pathSegments.length === 2 &&
      resource === "session" &&
      id === "status"
    ) {
      return { kind: "merged", shape: "record" };
    }
  }
  return { kind: "workspace-default" };
}

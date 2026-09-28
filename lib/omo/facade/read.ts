import {
  readOmoCatalog,
  type OmoCatalogRoute,
} from "@/lib/omo/facade/read-catalog";
import { responseForOmoReadError } from "@/lib/omo/facade/read-errors";
import { readOmoSessionIdentities } from "@/lib/omo/facade/read-identities";
import { readOmoMessages } from "@/lib/omo/facade/read-messages";
import {
  createOmoReadContext,
  getOmoDialogLedger,
} from "@/lib/omo/facade/read-runtime";
import {
  listOmoSessions,
  readOmoChildren,
  readOmoSession,
  readOmoSessionStats,
  readOmoSessionStatus,
  readOmoTodos,
} from "@/lib/omo/facade/read-sessions";
import {
  jsonResponse,
  unsupportedResponse,
  type OmoReadContext,
  type OmoReadRequest,
} from "@/lib/omo/facade/read-types";
import { ensureOmoConnectionIfNeeded } from "@/lib/omo/runtime";
import { getOmoIndexRow } from "@/lib/omo/session-index";

export type {
  OmoReadRequest,
  OmoReadWorkspace,
} from "@/lib/omo/facade/read-types";

const CATALOG_ROUTES = new Set<OmoCatalogRoute>([
  "/command",
  "/agent",
  "/config/providers",
  "/mcp",
]);

function normalizedPath(path: string): string {
  if (path === "/") return path;
  return path.endsWith("/") ? path.slice(0, -1) : path;
}

function rawOmoId(publicId: string): string | null {
  if (!publicId.startsWith("omo_")) return null;
  const rawId = publicId.slice("omo_".length);
  return rawId.length > 0 ? rawId : null;
}

async function healthResponse(context: OmoReadContext): Promise<Response> {
  try {
    const protocol = await context.runtime.client.connect();
    return jsonResponse({
      healthy: true,
      version: protocol.serverVersion ?? String(protocol.protocolVersion),
    });
  } catch {
    return jsonResponse({ healthy: false }, { status: 503 });
  }
}

async function isOmoIdKnown(
  context: OmoReadContext,
  rawId: string,
): Promise<boolean> {
  const row = await getOmoIndexRow(context.workspace.id, rawId);
  if (row !== null) return true;
  return context.source.authorizeSession(rawId);
}

async function readSessionRoute(
  context: OmoReadContext,
  path: string,
  query: URLSearchParams,
): Promise<Response> {
  const match = /^\/session\/([^/]+)(?:\/(message|children|todo|stats))?$/.exec(
    path,
  );
  if (match === null) return unsupportedResponse();
  const publicId = match[1];
  const rawId = publicId === undefined ? null : rawOmoId(publicId);
  if (rawId === null) return unsupportedResponse();
  switch (match[2]) {
    case "message":
      return readOmoMessages(context, rawId, query);
    case "children":
      return readOmoChildren(context, rawId);
    case "stats":
      return readOmoSessionStats(context, rawId);
    case "todo":
      if (!(await isOmoIdKnown(context, rawId))) {
        return jsonResponse({ error: "session_not_found" }, { status: 404 });
      }
      return readOmoTodos();
    case undefined:
      return readOmoSession(context, rawId);
    default:
      return unsupportedResponse();
  }
}

async function routeOmoRead(request: OmoReadRequest): Promise<Response> {
  if (request.method !== "GET") return unsupportedResponse();
  const path = normalizedPath(request.path);
  const context = createOmoReadContext(request.workspace);
  await ensureOmoConnectionIfNeeded(request.workspace, context.runtime);
  if (path === "/global/health") return healthResponse(context);
  if (path === "/permission") return jsonResponse([]);
  if (path === "/session/identities") {
    return readOmoSessionIdentities(request.workspace);
  }
  if (path === "/question") {
    return jsonResponse(
      getOmoDialogLedger(context.runtime).requestsForWorkspace(
        request.workspace.id,
      ),
    );
  }
  if (path === "/session/status") {
    return readOmoSessionStatus(context);
  }
  if (path === "/session") {
    return listOmoSessions(context);
  }
  if (CATALOG_ROUTES.has(path as OmoCatalogRoute)) {
    return readOmoCatalog(context, path as OmoCatalogRoute);
  }
  return readSessionRoute(context, path, request.query);
}

export async function handleOmoRead(
  request: OmoReadRequest,
): Promise<Response> {
  try {
    return await routeOmoRead(request);
  } catch (error) {
    const response = responseForOmoReadError(error);
    if (response !== null) return response;
    throw error;
  }
}

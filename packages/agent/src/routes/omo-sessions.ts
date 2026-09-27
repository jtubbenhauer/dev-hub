import type { Context, Next } from "hono";
import { Hono } from "hono";
import { realpath } from "node:fs/promises";
import { isAuthorizedBearer } from "../omo/auth.js";
import {
  ensureOmoDaemon,
  getOmoDaemonStatus,
  OmoDaemonError,
  resolveOmoAgentDir,
  type OmoDaemonErrorKind,
} from "../omo/daemon.js";
import {
  deleteOmoSession,
  listOmoSessionsForWorkspace,
  readOmoSessionEntries,
} from "../omo/sessions.js";

function bearerAuthMiddleware() {
  return async (c: Context, next: Next) => {
    const isAuthorized = isAuthorizedBearer(
      c.req.header("Authorization"),
      process.env.DEVHUB_AGENT_TOKEN,
    );
    if (!isAuthorized) return c.json({ error: "Unauthorized" }, 401);
    await next();
  };
}

function daemonErrorStatus(kind: OmoDaemonErrorKind): 400 | 501 | 502 | 503 {
  switch (kind) {
    case "usage":
      return 400;
    case "unsupported_platform":
      return 501;
    case "not_running":
      return 503;
    case "engine_refused":
      return 502;
  }
}

export function omoSessionRoutes(workspacePath: string): Hono {
  const app = new Hono();
  app.use("*", bearerAuthMiddleware());

  app.post("/daemon/ensure", async (c) => {
    try {
      const info = await ensureOmoDaemon();
      return c.json(info);
    } catch (error) {
      if (error instanceof OmoDaemonError) {
        return c.json(
          { error: error.message, kind: error.kind },
          daemonErrorStatus(error.kind),
        );
      }
      throw error;
    }
  });

  app.get("/daemon/status", async (c) => {
    try {
      const status = await getOmoDaemonStatus();
      return c.json(status);
    } catch (error) {
      if (error instanceof OmoDaemonError) {
        return c.json(
          { error: error.message, kind: error.kind },
          daemonErrorStatus(error.kind),
        );
      }
      throw error;
    }
  });

  app.get("/realpath", async (c) => {
    const path = await realpath(workspacePath);
    return c.json({ path });
  });

  app.get("/sessions", async (c) => {
    const agentDir = resolveOmoAgentDir();
    const summaries = await listOmoSessionsForWorkspace(
      agentDir,
      workspacePath,
    );
    return c.json(summaries);
  });

  app.get("/sessions/:id/entries", async (c) => {
    const agentDir = resolveOmoAgentDir();
    const summaries = await listOmoSessionsForWorkspace(
      agentDir,
      workspacePath,
    );
    const summary = summaries.find((s) => s.durableId === c.req.param("id"));
    if (!summary) return c.json({ error: "Session not found" }, 404);

    const entries = await readOmoSessionEntries(summary.sessionPath);
    return c.json(entries);
  });

  app.delete("/sessions/:id", async (c) => {
    const agentDir = resolveOmoAgentDir();
    const summaries = await listOmoSessionsForWorkspace(
      agentDir,
      workspacePath,
    );
    const summary = summaries.find((s) => s.durableId === c.req.param("id"));
    if (!summary) return c.json({ error: "Session not found" }, 404);

    await deleteOmoSession(agentDir, summary.sessionPath);
    return c.json({ deleted: true });
  });

  return app;
}

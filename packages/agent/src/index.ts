import { serve } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import { Hono } from "hono";
import { fileRoutes } from "./routes/files.js";
import { gitRoutes } from "./routes/git.js";
import { commandRoutes } from "./routes/commands.js";
import { opencodeRoutes } from "./routes/opencode.js";
import { omoRpcTunnelRoutes } from "./routes/omo-rpc-tunnel.js";

const workspacePath = process.env.WORKSPACE_PATH;
if (!workspacePath) {
  console.error("[agent] WORKSPACE_PATH environment variable is required");
  process.exit(1);
}

const port = parseInt(process.env.AGENT_PORT ?? "7500", 10);

const app = new Hono();
const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

app.get("/health", (c) => {
  return c.json({ status: "ok", workspacePath });
});

app.route("/files", fileRoutes(workspacePath));
app.route("/git", gitRoutes(workspacePath));
app.route("/commands", commandRoutes(workspacePath));
app.route("/opencode", opencodeRoutes());
app.route("/omo", omoRpcTunnelRoutes(upgradeWebSocket));

app.onError((error, c) => {
  console.error(`[agent] ${c.req.method} ${c.req.path} error:`, error.message);
  return c.json({ error: error.message }, 500);
});

const server = serve({ fetch: app.fetch, port }, () => {
  console.log(`[agent] listening on :${port} — workspace: ${workspacePath}`);
});
injectWebSocket(server);

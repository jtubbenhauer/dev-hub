import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerDbTools } from "./tools-db.js";
import { registerSessionTools } from "./tools-sessions.js";

const server = new McpServer({
  name: "dev-hub",
  version: "0.1.0",
});

registerDbTools(server);
registerSessionTools(server);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("[dev-hub-mcp] Server started on stdio transport");

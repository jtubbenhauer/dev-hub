import { homedir } from "node:os";
import { join } from "node:path";

export function resolveOmoAgentDir(): string {
  return (
    process.env.OMO_CODING_AGENT_DIR ||
    process.env.SENPI_CODING_AGENT_DIR ||
    join(homedir(), ".omo", "agent")
  );
}

export function resolveOmoSocketPath(agentDir: string): string {
  return process.env.OMO_RPC_SOCKET || join(agentDir, "rpc", "rpc.sock");
}

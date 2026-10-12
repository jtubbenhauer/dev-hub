import { record, stripCompletionCommand } from "@/lib/lsp/bridge-protocol";
import {
  isLspRecord,
  LSP_PHASE2_SERVER_CAPABILITIES,
  type JsonRpcResponse,
} from "@/lib/lsp/types";

const allowedServerCapabilities: readonly string[] =
  LSP_PHASE2_SERVER_CAPABILITIES;
const CLIENT_OWNED_COMMAND = "_typescript.moveToFileRefactoring";

function withoutClientOwnedCommand(provider: unknown): unknown {
  if (!isLspRecord(provider) || !Array.isArray(provider.commands))
    return provider;
  return {
    ...provider,
    commands: provider.commands.filter(
      (command) => command !== CLIENT_OWNED_COMMAND,
    ),
  };
}

function trimInitializeResult(message: JsonRpcResponse): JsonRpcResponse {
  const result = message.result;
  if (!isLspRecord(result)) return message;
  const capabilities = Object.fromEntries(
    Object.entries(record(result.capabilities)).filter(([key]) =>
      allowedServerCapabilities.includes(key),
    ),
  );
  // Error responses never had the move command stripped; keep that exact.
  if (message.error === undefined && "executeCommandProvider" in capabilities)
    capabilities.executeCommandProvider = withoutClientOwnedCommand(
      capabilities.executeCommandProvider,
    );
  return { ...message, result: { ...result, capabilities } };
}

function stripCompletionResult(message: JsonRpcResponse): JsonRpcResponse {
  const result = message.result;
  if (Array.isArray(result))
    return { ...message, result: result.map(stripCompletionCommand) };
  if (isLspRecord(result) && Array.isArray(result.items))
    return {
      ...message,
      result: { ...result, items: result.items.map(stripCompletionCommand) },
    };
  return message;
}

export function rewriteServerResult(
  message: JsonRpcResponse,
  method: string | undefined,
): JsonRpcResponse {
  switch (method) {
    case "initialize":
      return trimInitializeResult(message);
    case "textDocument/completion":
      return stripCompletionResult(message);
    case "completionItem/resolve":
      return { ...message, result: stripCompletionCommand(message.result) };
    default:
      return message;
  }
}

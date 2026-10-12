import type * as Vscode from "vscode";
import type {
  Location as ProtocolLocation,
  Middleware,
  Position as ProtocolPosition,
} from "vscode-languageclient/browser.js";
import { isLspCommand, LSP_APPLY_EDIT_COMMAND } from "@/lib/lsp/types";
import { createEmptyCodeLensTitles } from "@/lib/lsp/client/empty-codelens-titles";

const SHOW_REFERENCES_COMMAND = "editor.action.showReferences";

interface ShowReferencesConverter {
  asUri(value: string): unknown;
  asPosition(value: ProtocolPosition): unknown;
  asLocation(value: ProtocolLocation): unknown;
}

type InstanceClass = new (...args: never[]) => unknown;

export interface LspMiddlewareContext {
  readonly getClient: () =>
    | { readonly protocol2CodeConverter: ShowReferencesConverter }
    | undefined;
  readonly vscodeTypes: {
    readonly Position: InstanceClass;
    readonly Location: InstanceClass;
  };
}

export function rewriteLspCommand(command: Vscode.Command): Vscode.Command {
  switch (command.command) {
    case LSP_APPLY_EDIT_COMMAND:
      return { ...command, command: "devhub.lsp.applyEdit" };
    case "editor.action.rename": {
      const args: unknown = command.arguments?.[0];
      return {
        ...command,
        command: "devhub.lsp.renameAt",
        arguments: Array.isArray(args) ? args : [],
      };
    }
    default:
      return command;
  }
}

function isProtocolPosition(value: unknown): value is ProtocolPosition {
  return (
    typeof value === "object" &&
    value !== null &&
    "line" in value &&
    typeof value.line === "number" &&
    "character" in value &&
    typeof value.character === "number"
  );
}

function isProtocolLocation(value: unknown): value is ProtocolLocation {
  return (
    typeof value === "object" &&
    value !== null &&
    "uri" in value &&
    typeof value.uri === "string" &&
    "range" in value &&
    typeof value.range === "object" &&
    value.range !== null &&
    "start" in value.range &&
    isProtocolPosition(value.range.start) &&
    "end" in value.range &&
    isProtocolPosition(value.range.end)
  );
}

interface ShowReferencesConversion {
  readonly converter: ShowReferencesConverter;
  readonly vscodeTypes: LspMiddlewareContext["vscodeTypes"];
}

// vtsls sends [uri, position, locations] in protocol shapes; asCommand copies them verbatim.
function convertShowReferencesArgument(
  argument: unknown,
  index: number,
  { converter, vscodeTypes }: ShowReferencesConversion,
): unknown {
  const isRawLocation = (location: unknown): location is ProtocolLocation =>
    isProtocolLocation(location) && !(location instanceof vscodeTypes.Location);
  switch (index) {
    case 0:
      return typeof argument === "string"
        ? converter.asUri(argument)
        : argument;
    case 1:
      return isProtocolPosition(argument) &&
        !(argument instanceof vscodeTypes.Position)
        ? converter.asPosition(argument)
        : argument;
    case 2:
      return Array.isArray(argument) && argument.some(isRawLocation)
        ? argument.map((location: unknown) =>
            isRawLocation(location) ? converter.asLocation(location) : location,
          )
        : argument;
    default:
      return argument;
  }
}

function normaliseShowReferencesLens(
  lens: Vscode.CodeLens,
  context: LspMiddlewareContext,
): void {
  const command = lens.command;
  const originalArguments: readonly unknown[] | undefined = command?.arguments;
  if (command?.command !== SHOW_REFERENCES_COMMAND || !originalArguments)
    return;
  const converter = context.getClient()?.protocol2CodeConverter;
  if (!converter) return;
  const conversion = { converter, vscodeTypes: context.vscodeTypes };
  const convertedArguments = originalArguments.map((argument, index) =>
    convertShowReferencesArgument(argument, index, conversion),
  );
  if (
    convertedArguments.every(
      (value, index) => value === originalArguments[index],
    )
  )
    return;
  // Replace the command on the same lens: codeLens/resolve keeps `data` only for ProtocolCodeLens instances.
  lens.command = { ...command, arguments: convertedArguments };
}

export function buildLspMiddleware(
  middlewareContext: LspMiddlewareContext,
): Middleware {
  const emptyCodeLensTitles = createEmptyCodeLensTitles();
  return {
    async provideCodeActions(document, range, context, token, next) {
      const actions = await next(document, range, context, token);
      return (
        actions?.map((action) => {
          if (isLspCommand(action)) return rewriteLspCommand(action);
          // Preserve ProtocolCodeAction identity so the converter retains resolve data.
          if (action.command)
            action.command = rewriteLspCommand(action.command);
          return action;
        }) ?? actions
      );
    },
    async resolveCodeAction(action, token, next) {
      const resolved = await next(action, token);
      if (resolved?.command)
        resolved.command = rewriteLspCommand(resolved.command);
      return resolved;
    },
    async provideCodeLenses(document, token, next) {
      const lenses = await next(document, token);
      lenses?.forEach((lens) =>
        normaliseShowReferencesLens(lens, middlewareContext),
      );
      if (lenses) emptyCodeLensTitles.rememberProvidedLenses(lenses);
      return lenses;
    },
    async resolveCodeLens(codeLens, token, next) {
      const resolved = await next(codeLens, token);
      if (!resolved) return resolved;
      normaliseShowReferencesLens(resolved, middlewareContext);
      // The client hands the requested lens back on cancellation; only label fresh server answers.
      const title =
        resolved.command || resolved === codeLens
          ? undefined
          : emptyCodeLensTitles.titleFor(codeLens);
      // An empty command id renders as plain text instead of Monaco's "no commands".
      if (title) resolved.command = { title, command: "" };
      return resolved;
    },
  };
}

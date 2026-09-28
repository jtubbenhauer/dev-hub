import type { JsonlRecord } from "@/lib/omo/jsonl";

type CatalogVariant = Readonly<Record<string, never>>;

export type OmoCatalogModel = {
  readonly id: string;
  readonly name: string;
  readonly variants: Readonly<Record<string, CatalogVariant>>;
};

export type OmoCatalogProvider = {
  readonly id: string;
  readonly name: string;
  readonly models: Readonly<Record<string, OmoCatalogModel>>;
};

export type OmoCatalogProviders = {
  readonly providers: readonly OmoCatalogProvider[];
  readonly default: Readonly<Record<string, string>>;
};

export type OmoCatalogAgent = {
  readonly name: string;
  readonly description: string;
  readonly mode: "primary";
};

export type OmoCatalogCommand = {
  readonly name: string;
  readonly description: string;
};

export type OmoCatalogMcp = Readonly<
  Record<string, { readonly status: string }>
>;

export type OmoCatalog = {
  readonly providers: OmoCatalogProviders;
  readonly agents: readonly OmoCatalogAgent[];
  readonly commands: readonly OmoCatalogCommand[];
  readonly mcp: OmoCatalogMcp;
};

export type OmoCatalogModelRow = {
  readonly provider: string;
  readonly id: string;
  readonly name: string;
  readonly thinkingLevels: readonly string[] | undefined;
};

type BuildCatalogInput = {
  readonly models: readonly OmoCatalogModelRow[];
  readonly fallbackThinkingLevels: ReadonlyMap<string, readonly string[]>;
  readonly commandsResponse: JsonlRecord;
  readonly surfacesResponse: JsonlRecord;
};

function isRecord(value: unknown): value is JsonlRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function responseData(response: JsonlRecord, command: string): JsonlRecord {
  const data = response["data"];
  if (!isRecord(data)) {
    throw new TypeError(`Invalid OmO ${command} response`);
  }
  return data;
}

function stringArray(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const strings = value.filter(
    (entry): entry is string => typeof entry === "string",
  );
  return strings.length === value.length ? strings : undefined;
}

export function catalogModelKey(provider: string, modelId: string): string {
  return `${provider}\u0000${modelId}`;
}

export function readCatalogModels(
  response: JsonlRecord,
): readonly OmoCatalogModelRow[] {
  const values = responseData(response, "get_available_models")["models"];
  if (!Array.isArray(values)) {
    throw new TypeError("Invalid OmO get_available_models response");
  }
  const models: OmoCatalogModelRow[] = [];
  for (const value of values) {
    if (!isRecord(value)) continue;
    const provider = value["provider"];
    const id = value["id"];
    const name = value["name"];
    if (
      typeof provider !== "string" ||
      typeof id !== "string" ||
      typeof name !== "string"
    ) {
      continue;
    }
    models.push({
      provider,
      id,
      name,
      thinkingLevels: stringArray(value["thinkingLevels"]),
    });
  }
  return models;
}

export function readThinkingLevels(response: JsonlRecord): readonly string[] {
  return (
    stringArray(
      responseData(response, "get_available_thinking_levels")["levels"],
    ) ?? []
  );
}

function buildProviders(
  models: readonly OmoCatalogModelRow[],
  fallbackThinkingLevels: ReadonlyMap<string, readonly string[]>,
): OmoCatalogProviders {
  const providerModels = new Map<string, Record<string, OmoCatalogModel>>();
  const defaults: Record<string, string> = {};
  for (const model of models) {
    let mappedModels = providerModels.get(model.provider);
    if (mappedModels === undefined) {
      mappedModels = {};
      providerModels.set(model.provider, mappedModels);
      defaults[model.provider] = model.id;
    }
    const levels =
      model.thinkingLevels ??
      fallbackThinkingLevels.get(catalogModelKey(model.provider, model.id)) ??
      [];
    mappedModels[model.id] = {
      id: model.id,
      name: model.name,
      variants: Object.fromEntries(levels.map((level) => [level, {}])),
    };
  }
  return {
    providers: [...providerModels].map(([id, modelsById]) => ({
      id,
      name: id,
      models: modelsById,
    })),
    default: defaults,
  };
}

function buildCommands(response: JsonlRecord): {
  readonly agents: readonly OmoCatalogAgent[];
  readonly commands: readonly OmoCatalogCommand[];
} {
  const values = responseData(response, "get_commands")["commands"];
  if (!Array.isArray(values)) {
    throw new TypeError("Invalid OmO get_commands response");
  }
  const agents: OmoCatalogAgent[] = [];
  const commands: OmoCatalogCommand[] = [];
  for (const value of values) {
    if (!isRecord(value) || typeof value["name"] !== "string") continue;
    const name = value["name"];
    const description =
      typeof value["description"] === "string" ? value["description"] : "";
    if (value["source"] === "skill") {
      agents.push({
        name: name.startsWith("skill:") ? name : `skill:${name}`,
        description,
        mode: "primary",
      });
    } else if (
      value["source"] === "extension" ||
      value["source"] === "prompt"
    ) {
      commands.push({ name, description });
    }
  }
  return { agents, commands };
}

function buildMcp(response: JsonlRecord): OmoCatalogMcp {
  const values = responseData(response, "get_loaded_surfaces")["mcpServers"];
  if (!Array.isArray(values)) {
    throw new TypeError("Invalid OmO get_loaded_surfaces response");
  }
  const mcp: Record<string, { readonly status: string }> = {};
  for (const value of values) {
    if (
      isRecord(value) &&
      typeof value["name"] === "string" &&
      typeof value["status"] === "string"
    ) {
      mcp[value["name"]] = { status: value["status"] };
    }
  }
  return mcp;
}

export function buildCatalog(input: BuildCatalogInput): OmoCatalog {
  const { agents, commands } = buildCommands(input.commandsResponse);
  return {
    providers: buildProviders(input.models, input.fallbackThinkingLevels),
    agents,
    commands,
    mcp: buildMcp(input.surfacesResponse),
  };
}

export interface OmoSessionSelection {
  readonly model: {
    readonly providerID: string;
    readonly modelID: string;
  } | null;
  readonly variant: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyText(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function toOmoSessionSelection(
  value: unknown,
): OmoSessionSelection | null {
  if (!isRecord(value)) return null;
  const model = value["model"];
  const providerID = isRecord(model) ? nonEmptyText(model["providerID"]) : null;
  const modelID = isRecord(model) ? nonEmptyText(model["modelID"]) : null;
  return {
    model:
      providerID !== null && modelID !== null ? { providerID, modelID } : null,
    variant: nonEmptyText(value["variant"]),
  };
}

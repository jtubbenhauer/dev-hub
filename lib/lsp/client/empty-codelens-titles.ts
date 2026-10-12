import type * as Vscode from "vscode";

type EmptyCodeLensTitle = "0 references" | "0 implementations";

export interface EmptyCodeLensTitles {
  rememberProvidedLenses(lenses: readonly Vscode.CodeLens[]): void;
  titleFor(requestedLens: Vscode.CodeLens): EmptyCodeLensTitle | undefined;
}

// vtsls keeps its code-lens provider id in the protocol lens `data`.
function vtslsProviderIdOf(lens: Vscode.CodeLens): number | undefined {
  if (!("data" in lens)) return undefined;
  const { data } = lens;
  return typeof data === "object" &&
    data !== null &&
    "id" in data &&
    typeof data.id === "number"
    ? data.id
    : undefined;
}

// vtsls answers codeLens/resolve with the unresolved lens when a lens has no results.
// Implementation lenses only sit on lines that also carry a references lens (vtsls-settings
// enables both), so a provider seen alone on a line is a references provider.
export function createEmptyCodeLensTitles(): EmptyCodeLensTitles {
  // Bounded by the number of vtsls code-lens providers.
  const referencesProviderIds = new Set<number>();
  return {
    rememberProvidedLenses(lenses) {
      const lensCountByLine = new Map<number, number>();
      for (const lens of lenses) {
        const line = lens.range.start.line;
        lensCountByLine.set(line, (lensCountByLine.get(line) ?? 0) + 1);
      }
      for (const lens of lenses) {
        const providerId = vtslsProviderIdOf(lens);
        if (
          providerId !== undefined &&
          lensCountByLine.get(lens.range.start.line) === 1
        )
          referencesProviderIds.add(providerId);
      }
    },
    titleFor(requestedLens) {
      const providerId = vtslsProviderIdOf(requestedLens);
      if (providerId === undefined || referencesProviderIds.size === 0)
        return undefined;
      return referencesProviderIds.has(providerId)
        ? "0 references"
        : "0 implementations";
    },
  };
}

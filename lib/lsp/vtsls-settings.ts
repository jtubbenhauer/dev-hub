const INLAY_HINTS = {
  parameterNames: {
    enabled: "literals",
    suppressWhenArgumentMatchesName: true,
  },
  parameterTypes: { enabled: false },
  variableTypes: { enabled: false },
  propertyDeclarationTypes: { enabled: false },
  functionLikeReturnTypes: { enabled: false },
  enumMemberValues: { enabled: true },
} as const;

export const VTSLS_SETTINGS = {
  typescript: {
    referencesCodeLens: { enabled: true },
    implementationsCodeLens: { enabled: true },
    inlayHints: INLAY_HINTS,
    format: { enable: true },
    tsserver: { maxTsServerMemory: 3072 },
    preferences: { importModuleSpecifier: "shortest" },
  },
  javascript: {
    referencesCodeLens: { enabled: true },
    inlayHints: INLAY_HINTS,
    format: { enable: true },
    preferences: { importModuleSpecifier: "shortest" },
  },
  vtsls: {
    enableMoveToFileCodeAction: true,
    autoUseWorkspaceTsdk: true,
    experimental: {
      completion: { enableServerSideFuzzyMatch: true, entriesLimit: 50 },
    },
  },
} as const;

export function getSettingsSection(section: string | undefined): unknown {
  if (section === undefined || section === "") return VTSLS_SETTINGS;
  let current: unknown = VTSLS_SETTINGS;
  for (const key of section.split(".")) {
    if (
      typeof current !== "object" ||
      current === null ||
      !Object.hasOwn(current, key)
    ) {
      return null;
    }
    current = Reflect.get(current, key);
  }
  return current;
}

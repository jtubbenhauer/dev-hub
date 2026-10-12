export function resolveTabWorkspaceId(
  tab: { readonly workspaceId?: string },
  fallbackWorkspaceId: string,
): string {
  return tab.workspaceId ?? fallbackWorkspaceId;
}

export function buildFileSaveBody(input: {
  readonly workspaceId: string;
  readonly path: string;
  readonly content: string;
  readonly originalContent: string;
  readonly isLspEnabled: boolean;
}): {
  workspaceId: string;
  path: string;
  content: string;
  baseContent?: string;
} {
  const { workspaceId, path, content } = input;
  return {
    workspaceId,
    path,
    content,
    ...(input.isLspEnabled ? { baseContent: input.originalContent } : {}),
  };
}

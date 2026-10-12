export const MAX_RETAINED_WORKSPACE_OVERLAYS = 8;

interface OverlayRegistration {
  dispose(): void;
}

export interface WorkspaceOverlayTarget {
  readonly workspaceId: string;
  readonly workspaceRoot: string;
}

interface RetainedOverlay {
  readonly workspaceId: string;
  readonly registration: OverlayRegistration;
}

// Insertion order doubles as recency: the first entry is the least recently used.
const overlaysByRoot = new Map<string, RetainedOverlay>();

// Editors keep file:// models across LSP toggles and reconnects, and Monaco re-reads them
// (e.g. the word highlighter) before the next session starts, so overlays outlive sessions.
export function ensureWorkspaceFileOverlay(
  { workspaceId, workspaceRoot }: WorkspaceOverlayTarget,
  register: () => OverlayRegistration,
): void {
  const existing = overlaysByRoot.get(workspaceRoot);
  overlaysByRoot.delete(workspaceRoot);
  if (existing?.workspaceId === workspaceId) {
    overlaysByRoot.set(workspaceRoot, existing);
    return;
  }
  existing?.registration.dispose();
  overlaysByRoot.set(workspaceRoot, { workspaceId, registration: register() });
  for (const [root, overlay] of overlaysByRoot) {
    if (overlaysByRoot.size <= MAX_RETAINED_WORKSPACE_OVERLAYS) return;
    overlaysByRoot.delete(root);
    overlay.registration.dispose();
  }
}

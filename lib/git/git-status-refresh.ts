// Lets non-React code (LSP edits, chat events) ask mounted git-status queries to refetch.
type GitStatusRefreshListener = (workspaceId: string) => void;

const gitStatusRefreshListeners = new Set<GitStatusRefreshListener>();

export function requestGitStatusRefresh(workspaceId: string): void {
  for (const listener of gitStatusRefreshListeners) listener(workspaceId);
}

export function subscribeToGitStatusRefresh(
  listener: GitStatusRefreshListener,
): () => void {
  gitStatusRefreshListeners.add(listener);
  return () => {
    gitStatusRefreshListeners.delete(listener);
  };
}

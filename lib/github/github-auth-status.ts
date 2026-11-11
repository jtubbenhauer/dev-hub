// Which GitHub login dev-hub signs its GitHub requests with. Shared by the
// /api/github-auth route and the Settings card.

export type GitHubAuthSource = "gh" | "settings";

export interface GitHubAuthStatus {
  // The login the GitHub proxy uses: the GitHub CLI login on the machine
  // running dev-hub, else the token saved in Settings.
  activeSource: GitHubAuthSource | null;
  // GitHub user of each login, or null when it is missing or GitHub rejects it.
  ghLogin: string | null;
  hasSavedToken: boolean;
  savedTokenLogin: string | null;
}

export const GITHUB_AUTH_STATUS_QUERY_KEY = ["github", "auth-status"] as const;

export const GITHUB_NOT_CONNECTED_MESSAGE =
  "GitHub isn't connected. Run `gh auth login` on the machine running dev-hub, or add a token in Settings → Integrations.";

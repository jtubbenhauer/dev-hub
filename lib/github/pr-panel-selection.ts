// Opens a pull request in dev-hub's own PR review page (/prs), which reads
// the stored selection when it mounts.

export const PR_PANEL_PATH = "/prs";
export const SELECTED_PR_STORAGE_KEY = "dev-hub:git-selected-pr";
const SELECTED_PR_FILE_STORAGE_KEY = "dev-hub:pr-selected-file";

export interface OpenPullRequestInDevHubInput {
  nameWithOwner: string;
  number: number;
  navigate: (href: string) => void;
}

export function openPullRequestInDevHub(
  input: OpenPullRequestInDevHubInput,
): void {
  localStorage.setItem(
    SELECTED_PR_STORAGE_KEY,
    `${input.nameWithOwner}/${input.number}`,
  );
  localStorage.removeItem(SELECTED_PR_FILE_STORAGE_KEY);
  input.navigate(PR_PANEL_PATH);
}

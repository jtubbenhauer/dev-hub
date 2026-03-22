export function extractOwnerRepo(
  remoteUrl: string,
): { owner: string; repo: string } | null {
  if (!remoteUrl || typeof remoteUrl !== "string") {
    return null;
  }

  const url = remoteUrl.replace(/\/+$/, "").replace(/\.git$/, "");

  const httpsMatch = url.match(/^https?:\/\/([^/]+)\/([^/]+)\/(.+)$/);
  if (httpsMatch) {
    const host = httpsMatch[1];
    if (!host.includes("github.com")) {
      return null;
    }
    return {
      owner: httpsMatch[2],
      repo: httpsMatch[3],
    };
  }

  const sshMatch = url.match(/^git@([^:]+):([^/]+)\/(.+)$/);
  if (sshMatch) {
    const host = sshMatch[1];
    if (!host.includes("github.com")) {
      return null;
    }
    return {
      owner: sshMatch[2],
      repo: sshMatch[3],
    };
  }

  return null;
}

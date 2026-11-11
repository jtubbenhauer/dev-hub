import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import type { GitHubAuthStatus } from "@/lib/github/github-auth-status";
import {
  fetchGitHubLogin,
  forgetGhToken,
  getGhToken,
  readSettingsToken,
} from "@/lib/github/github-token";

// Which GitHub login dev-hub uses, for the Settings card.
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Read gh afresh so a `gh auth login` shows up as soon as Settings opens.
  forgetGhToken();
  const [ghToken, savedToken] = await Promise.all([
    getGhToken(),
    readSettingsToken(session.user.id),
  ]);
  const [ghLogin, savedTokenLogin] = await Promise.all([
    ghToken ? fetchGitHubLogin(ghToken) : null,
    savedToken ? fetchGitHubLogin(savedToken) : null,
  ]);

  const status: GitHubAuthStatus = {
    activeSource: ghToken ? "gh" : savedToken ? "settings" : null,
    ghLogin,
    hasSavedToken: savedToken !== null,
    savedTokenLogin,
  };
  return NextResponse.json(status);
}

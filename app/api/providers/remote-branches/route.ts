import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import simpleGit from "simple-git";
import os from "node:os";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const repo = request.nextUrl.searchParams.get("repo");
  if (!repo) {
    return NextResponse.json(
      { error: "repo query parameter is required" },
      { status: 400 },
    );
  }

  try {
    const git = simpleGit(os.tmpdir());
    const result = await git.listRemote(["--heads", repo]);

    const branches = result
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const ref = line.split("\t")[1] ?? "";
        return ref.replace("refs/heads/", "");
      })
      .filter(Boolean)
      .sort((a, b) => {
        if (a === "main") return -1;
        if (b === "main") return 1;
        if (a === "master") return -1;
        if (b === "master") return 1;
        return a.localeCompare(b);
      });

    return NextResponse.json({ branches });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to list remote branches";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

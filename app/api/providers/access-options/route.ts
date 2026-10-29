import { NextRequest, NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db";
import { settings } from "@/drizzle/schema";
import { parseAccessOptions } from "@/lib/workspaces/access-profiles";
import type { WorkspaceProvider } from "@/types";

const ACCESS_OPTIONS_TIMEOUT_MS = 20_000;

function isWorkspaceProvider(value: unknown): value is WorkspaceProvider {
  if (!value || typeof value !== "object") return false;
  const provider = value as Record<string, unknown>;
  return (
    typeof provider.id === "string" &&
    typeof provider.name === "string" &&
    typeof provider.binaryPath === "string" &&
    typeof provider.commands === "object" &&
    provider.commands !== null
  );
}

function runAccessOptionsCommand(command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "sh",
      ["-c", command],
      { timeout: ACCESS_OPTIONS_TIMEOUT_MS, maxBuffer: 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(stdout);
      },
    );
  });
}

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const providerId = request.nextUrl.searchParams.get("providerId");
  if (!providerId) {
    return NextResponse.json(
      { error: "providerId is required" },
      { status: 400 },
    );
  }

  const [settingRow] = await db
    .select()
    .from(settings)
    .where(
      and(
        eq(settings.userId, session.user.id),
        eq(settings.key, "workspace-providers"),
      ),
    );
  const providerList = Array.isArray(settingRow?.value)
    ? (settingRow.value as unknown[]).filter(isWorkspaceProvider)
    : [];
  const provider = providerList.find(
    (candidate) => candidate.id === providerId,
  );
  if (!provider) {
    return NextResponse.json({ error: "Provider not found" }, { status: 404 });
  }

  const commandTemplate = provider.commands.accessOptions;
  if (!commandTemplate) {
    return NextResponse.json({ options: [] });
  }

  const command = commandTemplate.replaceAll("{binary}", provider.binaryPath);
  try {
    const stdout = await runAccessOptionsCommand(command);
    const options = parseAccessOptions(JSON.parse(stdout));
    return NextResponse.json({ options });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    return NextResponse.json(
      { error: `Access options command failed: ${message}` },
      { status: 502 },
    );
  }
}

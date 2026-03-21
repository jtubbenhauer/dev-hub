import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db";
import { workspaces, settings } from "@/drizzle/schema";
import { eq, and } from "drizzle-orm";
import type { WorkspaceProvider } from "@/types";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const workspaceId = request.nextUrl.searchParams.get("workspaceId");
  if (!workspaceId) {
    return NextResponse.json(
      { error: "workspaceId is required" },
      { status: 400 },
    );
  }

  const [workspace] = await db
    .select()
    .from(workspaces)
    .where(
      and(
        eq(workspaces.id, workspaceId),
        eq(workspaces.userId, session.user.id),
      ),
    );

  if (!workspace) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  const ptyPort = parseInt(process.env.PTY_SERVER_PORT ?? "7600", 10);

  if (workspace.backend === "local") {
    return NextResponse.json({
      wsUrl: `ws://127.0.0.1:${ptyPort}`,
      cwd: workspace.path,
      shellCommand: null,
    });
  }

  if (workspace.shellCommand) {
    return NextResponse.json({
      wsUrl: `ws://127.0.0.1:${ptyPort}`,
      cwd: workspace.path,
      shellCommand: workspace.shellCommand,
    });
  }

  const meta = workspace.providerMeta as Record<string, unknown> | null;
  const providerId =
    typeof meta?.providerId === "string" ? meta.providerId : null;
  const providerWorkspaceId =
    typeof meta?.providerWorkspaceId === "string"
      ? meta.providerWorkspaceId
      : null;

  if (providerId && providerWorkspaceId) {
    const provider = await findProvider(session.user.id, providerId);
    if (provider?.commands.shell) {
      const resolved = provider.commands.shell
        .replaceAll("{binary}", provider.binaryPath)
        .replaceAll("{id}", providerWorkspaceId);

      return NextResponse.json({
        wsUrl: `ws://127.0.0.1:${ptyPort}`,
        cwd: workspace.path,
        shellCommand: resolved,
      });
    }
  }

  return NextResponse.json(
    {
      error:
        "No shell command configured. Set a shell command on the provider or workspace.",
    },
    { status: 422 },
  );
}

function isWorkspaceProvider(value: unknown): value is WorkspaceProvider {
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.id === "string" &&
    typeof obj.name === "string" &&
    typeof obj.binaryPath === "string" &&
    typeof obj.commands === "object" &&
    obj.commands !== null &&
    typeof (obj.commands as Record<string, unknown>).create === "string" &&
    typeof (obj.commands as Record<string, unknown>).destroy === "string" &&
    typeof (obj.commands as Record<string, unknown>).status === "string"
  );
}

async function findProvider(
  userId: string,
  providerId: string,
): Promise<WorkspaceProvider | null> {
  const [settingRow] = await db
    .select()
    .from(settings)
    .where(
      and(eq(settings.userId, userId), eq(settings.key, "workspace-providers")),
    );

  if (!settingRow) return null;

  const providerList = Array.isArray(settingRow.value)
    ? (settingRow.value as unknown[]).filter(isWorkspaceProvider)
    : [];

  return providerList.find((p) => p.id === providerId) ?? null;
}

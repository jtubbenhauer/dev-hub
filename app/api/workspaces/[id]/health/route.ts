import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db";
import { settings, workspaces } from "@/drizzle/schema";
import { eq, and } from "drizzle-orm";
import { toWorkspace } from "@/lib/workspaces/backend";
import { spawn } from "node:child_process";
import { interpolateProviderCommand } from "@/lib/workspaces/resume";
import type { Workspace, WorkspaceProvider } from "@/types";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const [row] = await db
    .select()
    .from(workspaces)
    .where(and(eq(workspaces.id, id), eq(workspaces.userId, session.user.id)));

  if (!row) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const workspace = toWorkspace(row);

  if (workspace.backend !== "remote") {
    return NextResponse.json({ status: "ok", backend: "local" });
  }

  if (!workspace.agentUrl) {
    return NextResponse.json({
      status: "unreachable",
      reason: "No agent URL configured",
    });
  }

  try {
    const response = await globalThis.fetch(
      new URL("/health", workspace.agentUrl).toString(),
      { signal: AbortSignal.timeout(5000) },
    );
    if (!response.ok) {
      return NextResponse.json({
        status: "unreachable",
        reason: `Agent returned ${response.status}`,
      });
    }
    const body = (await response.json()) as {
      status?: string;
      workspacePath?: string;
    };
    if (body.status === "ok") {
      return NextResponse.json({
        status: "ok",
        backend: "remote",
        workspacePath: body.workspacePath,
      });
    }
    return NextResponse.json({
      status: "unreachable",
      reason: "Agent returned unexpected status",
    });
  } catch {
    const isSuspended = await checkSuspendedStatus(workspace, session.user.id);
    if (isSuspended) {
      return NextResponse.json({ status: "suspended" });
    }
    return NextResponse.json({
      status: "unreachable",
      reason: "Cannot reach agent",
    });
  }
}

function spawnWithTimeout(command: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("sh", ["-c", command], { timeout: timeoutMs });
    let stdout = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Status command exited with code ${code}`));
      } else {
        resolve(stdout);
      }
    });
  });
}

async function checkSuspendedStatus(
  workspace: Workspace,
  userId: string,
): Promise<boolean> {
  if (!workspace.providerMeta) return false;

  const providerMeta = workspace.providerMeta as Record<string, unknown>;
  const providerId = providerMeta.providerId as string | undefined;
  if (!providerId) return false;

  const [settingRow] = await db
    .select()
    .from(settings)
    .where(
      and(eq(settings.userId, userId), eq(settings.key, "workspace-providers")),
    );
  if (!settingRow) return false;

  const providers = Array.isArray(settingRow.value)
    ? (settingRow.value as unknown[])
    : [];

  const provider = providers.find(
    (p) =>
      p &&
      typeof p === "object" &&
      (p as Record<string, unknown>).id === providerId,
  ) as WorkspaceProvider | undefined;

  if (!provider) return false;
  if (!provider.behaviour?.supportsAutoSuspend) return false;
  if (!provider.commands.status) return false;

  const command = interpolateProviderCommand(
    provider.commands.status,
    workspace,
    provider,
  );

  try {
    const output = await spawnWithTimeout(command, 10_000);
    const parsed: unknown = JSON.parse(output);

    if (!Array.isArray(parsed)) return false;

    const match = parsed.find((item: unknown) => {
      if (!item || typeof item !== "object") return false;
      const obj = item as Record<string, unknown>;
      return (
        obj.name === workspace.name ||
        obj.name === providerMeta.providerWorkspaceId
      );
    }) as Record<string, unknown> | undefined;

    if (!match) return false;

    const status = match.status;
    return status === "stopped" || status === "suspended";
  } catch {
    return false;
  }
}

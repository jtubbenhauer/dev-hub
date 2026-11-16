import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db";
import { settings, workspaces } from "@/drizzle/schema";
import { eq, and } from "drizzle-orm";
import { toWorkspace } from "@/lib/workspaces/backend";
import { spawn } from "node:child_process";
import { interpolateProviderCommand } from "@/lib/workspaces/resume";
import {
  findUpgradedEndpoints,
  lastOutputLines,
  parseUpgradeJsonOutput,
} from "@/lib/workspaces/upgrade";
import type { WorkspaceProvider } from "@/types";

export const maxDuration = 600;

const UPGRADE_TIMEOUT_MS = 570_000;

const upgradingWorkspaces = new Set<string>();

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(_request: NextRequest, { params }: RouteParams) {
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

  if (workspace.backend !== "remote" || !workspace.providerMeta) {
    return NextResponse.json(
      { error: "Workspace is not a remote provider workspace" },
      { status: 400 },
    );
  }

  const { providerId, providerWorkspaceId } = workspace.providerMeta as Record<
    string,
    unknown
  >;
  if (typeof providerId !== "string") {
    return NextResponse.json(
      { error: "Workspace has no provider ID" },
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

  if (!settingRow) {
    return NextResponse.json(
      { error: "No providers configured" },
      { status: 400 },
    );
  }

  const providers = Array.isArray(settingRow.value)
    ? (settingRow.value as unknown[])
    : [];
  const provider = providers.find(
    (candidate) =>
      candidate &&
      typeof candidate === "object" &&
      (candidate as Record<string, unknown>).id === providerId,
  ) as WorkspaceProvider | undefined;

  if (!provider) {
    return NextResponse.json({ error: "Provider not found" }, { status: 404 });
  }

  const upgradeTemplate = provider.commands.upgrade?.trim();
  if (!upgradeTemplate) {
    return NextResponse.json(
      { error: "Provider does not support upgrade" },
      { status: 400 },
    );
  }

  if (upgradingWorkspaces.has(id)) {
    return NextResponse.json(
      { error: "Workspace is already upgrading" },
      { status: 409 },
    );
  }

  upgradingWorkspaces.add(id);
  try {
    const command = interpolateProviderCommand(
      upgradeTemplate,
      workspace,
      provider,
    );
    const output = await runUpgradeCommand(command);
    const upgradeResults = parseUpgradeJsonOutput(output.stdout);
    const endpoints =
      upgradeResults && typeof providerWorkspaceId === "string"
        ? findUpgradedEndpoints(upgradeResults, providerWorkspaceId)
        : null;
    // An upgrade can move the container's endpoints (e.g. OpenCode moving
    // behind Tailscale Serve HTTPS), so save what the provider now reports.
    if (endpoints) {
      await db
        .update(workspaces)
        .set({ opencodeUrl: endpoints.opencode, agentUrl: endpoints.agent })
        .where(eq(workspaces.id, id));
    }
    const summarySource =
      upgradeResults || !output.stdout.trim() ? output.stderr : output.stdout;
    return NextResponse.json({
      status: "upgraded",
      summary: lastOutputLines(summarySource, 1),
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Upgrade command failed";
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    upgradingWorkspaces.delete(id);
  }
}

interface UpgradeCommandOutput {
  stdout: string;
  stderr: string;
}

function runUpgradeCommand(command: string): Promise<UpgradeCommandOutput> {
  return new Promise((resolve, reject) => {
    const child = spawn("sh", ["-c", command], {
      timeout: UPGRADE_TIMEOUT_MS,
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      const detail = lastOutputLines(stderr || stdout, 3);
      reject(
        new Error(
          `Upgrade command exited with code ${code}${detail ? `: ${detail}` : ""}`,
        ),
      );
    });
  });
}

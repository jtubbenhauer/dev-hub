import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db";
import { settings, workspaces } from "@/drizzle/schema";
import { eq, and } from "drizzle-orm";
import { toWorkspace } from "@/lib/workspaces/backend";
import { spawn } from "node:child_process";
import { interpolateProviderCommand } from "@/lib/workspaces/resume";
import type { WorkspaceProvider } from "@/types";

export const maxDuration = 150;

interface RouteParams {
  params: Promise<{ id: string }>;
}

const startingWorkspaces = new Map<string, Promise<Response>>();

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

  const providerMeta = workspace.providerMeta as Record<string, unknown>;
  const providerId = providerMeta.providerId as string | undefined;
  if (!providerId) {
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
    (p) =>
      p &&
      typeof p === "object" &&
      (p as Record<string, unknown>).id === providerId,
  ) as WorkspaceProvider | undefined;

  if (!provider) {
    return NextResponse.json({ error: "Provider not found" }, { status: 404 });
  }

  if (!provider.commands.start) {
    return NextResponse.json(
      { error: "Provider does not support start" },
      { status: 400 },
    );
  }

  const existing = startingWorkspaces.get(id);
  if (existing) {
    return NextResponse.json(
      { error: "Workspace is already starting" },
      { status: 409 },
    );
  }

  const promise = executeStart(workspace, provider, id);
  startingWorkspaces.set(id, promise);

  try {
    return await promise;
  } finally {
    startingWorkspaces.delete(id);
  }
}

async function executeStart(
  workspace: ReturnType<typeof toWorkspace>,
  provider: WorkspaceProvider,
  workspaceId: string,
): Promise<Response> {
  const command = interpolateProviderCommand(
    provider.commands.start!,
    workspace,
    provider,
  );

  try {
    const output = await spawnWithTimeout(command, 120_000);
    const parsed = JSON.parse(output) as {
      id?: string;
      endpoints?: { opencode?: string; agent?: string };
      status?: string;
    };

    if (parsed.endpoints?.opencode && parsed.endpoints?.agent) {
      await db
        .update(workspaces)
        .set({
          opencodeUrl: parsed.endpoints.opencode,
          agentUrl: parsed.endpoints.agent,
        })
        .where(eq(workspaces.id, workspaceId));
    }

    return NextResponse.json({
      status: "started",
      ...(parsed.endpoints && { endpoints: parsed.endpoints }),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Start command failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function spawnWithTimeout(command: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("sh", ["-c", command], { timeout: timeoutMs });
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
      if (code !== 0) {
        reject(
          new Error(
            `Start command exited with code ${code}${stderr ? `: ${stderr.trim()}` : ""}`,
          ),
        );
      } else {
        resolve(stdout);
      }
    });
  });
}

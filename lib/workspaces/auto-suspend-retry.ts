import { settings } from "@/drizzle/schema";
import { db } from "@/lib/db";
import type { Workspace, WorkspaceProvider } from "@/types";
import { and, eq } from "drizzle-orm";

export const OPEN_CODE_AUTO_SUSPEND_RETRY_DELAYS_MS = [
  2_000, 4_000, 8_000, 8_000, 8_000,
] as const;

type AutoSuspendRetryOptions = {
  readonly workspace: Workspace;
  readonly userId: string;
  readonly delaysMs: readonly number[];
  readonly request: () => Promise<Response>;
};

async function workspaceSupportsAutoSuspend(
  workspace: Workspace,
  userId: string,
): Promise<boolean> {
  const providerMeta = workspace.providerMeta as Record<string, unknown> | null;
  const providerId =
    providerMeta && typeof providerMeta.providerId === "string"
      ? providerMeta.providerId
      : null;
  if (!providerId) return false;

  const [settingRow] = await db
    .select()
    .from(settings)
    .where(
      and(eq(settings.userId, userId), eq(settings.key, "workspace-providers")),
    );
  if (!settingRow) return false;

  const providers = Array.isArray(settingRow.value) ? settingRow.value : [];
  const provider = providers.find(
    (candidate) =>
      candidate &&
      typeof candidate === "object" &&
      (candidate as Record<string, unknown>).id === providerId,
  ) as WorkspaceProvider | undefined;
  return provider?.behaviour?.supportsAutoSuspend === true;
}

export async function retryAutoSuspendRequest(
  options: AutoSuspendRetryOptions,
): Promise<Response | null> {
  if (
    !(await workspaceSupportsAutoSuspend(options.workspace, options.userId))
  ) {
    return null;
  }

  for (const delayMs of options.delaysMs) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    try {
      return await options.request();
    } catch {
      continue;
    }
  }
  return null;
}

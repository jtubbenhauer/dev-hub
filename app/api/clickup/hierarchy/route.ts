import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db";
import { settings } from "@/drizzle/schema";
import { eq, and } from "drizzle-orm";
import type {
  ClickUpSpace,
  ClickUpFolder,
  ClickUpList,
  ClickUpView,
} from "@/types";

const CLICKUP_API_BASE = "https://api.clickup.com/api/v2";

interface HierarchyResponse {
  spaces: ClickUpSpace[];
  views: ClickUpView[];
}

interface RawSpace {
  id: string;
  name: string;
  color: string | null;
}

interface RawFolder {
  id: string;
  name: string;
  lists: ClickUpList[];
}

interface RawView {
  id: string;
  name: string;
  type: string;
  parent: { id: string; type: number };
}

async function getSetting(userId: string, key: string): Promise<string | null> {
  const [row] = await db
    .select()
    .from(settings)
    .where(and(eq(settings.userId, userId), eq(settings.key, key)));
  const value = row?.value;
  return typeof value === "string" && value.length > 0 ? value : null;
}

async function fetchJson<T>(url: string, token: string): Promise<T> {
  const res = await fetch(url, {
    headers: { Authorization: token },
    next: { revalidate: 300 },
  });
  if (!res.ok) {
    const body: unknown = await res.json().catch(() => ({}));
    throw new Error(`ClickUp API error ${res.status}: ${JSON.stringify(body)}`);
  }
  return res.json() as Promise<T>;
}

export async function GET(): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [token, teamId] = await Promise.all([
    getSetting(session.user.id, "clickup-api-token"),
    getSetting(session.user.id, "clickup-team-id"),
  ]);

  if (!token || !teamId) {
    return NextResponse.json(
      { error: "ClickUp not configured" },
      { status: 422 },
    );
  }

  try {
    // Fetch spaces and workspace views in parallel
    const [spacesData, viewsData] = await Promise.all([
      fetchJson<{ spaces: RawSpace[] }>(
        `${CLICKUP_API_BASE}/team/${teamId}/space?archived=false`,
        token,
      ),
      fetchJson<{ views: RawView[] }>(
        `${CLICKUP_API_BASE}/team/${teamId}/view`,
        token,
      ),
    ]);

    // For each space, fetch folders and folderless lists in parallel
    const spaces: ClickUpSpace[] = await Promise.all(
      spacesData.spaces.map(async (space) => {
        const [foldersData, listsData] = await Promise.all([
          fetchJson<{ folders: RawFolder[] }>(
            `${CLICKUP_API_BASE}/space/${space.id}/folder?archived=false`,
            token,
          ),
          fetchJson<{ lists: ClickUpList[] }>(
            `${CLICKUP_API_BASE}/space/${space.id}/list?archived=false`,
            token,
          ),
        ]);

        const folders: ClickUpFolder[] = foldersData.folders.map((folder) => ({
          id: folder.id,
          name: folder.name,
          lists: folder.lists ?? [],
        }));

        return {
          id: space.id,
          name: space.name,
          color: space.color,
          folders,
          lists: listsData.lists ?? [],
        };
      }),
    );

    const result: HierarchyResponse = {
      spaces,
      views: viewsData.views ?? [],
    };

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Request failed";
    console.error(`[clickup] hierarchy fetch failed: ${message}`);
    return NextResponse.json(
      { error: "Failed to fetch hierarchy", detail: message },
      { status: 502 },
    );
  }
}

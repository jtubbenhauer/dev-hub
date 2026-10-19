import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db";
import { workspaces } from "@/drizzle/schema";
import { MAX_FILE_SIZE } from "@/lib/attachment-utils";
import { getBackend, toWorkspace } from "@/lib/workspaces/backend";
import { saveWorkspaceUpload } from "@/lib/workspaces/uploads";

const BASE64_DATA_URL_PATTERN = /^data:[^,]*;base64,/;

interface UploadRequest {
  workspaceId: string;
  filename: string;
  dataUrl: string;
}

function isUploadRequest(value: unknown): value is UploadRequest {
  return (
    typeof value === "object" &&
    value !== null &&
    "workspaceId" in value &&
    typeof value.workspaceId === "string" &&
    value.workspaceId.length > 0 &&
    "filename" in value &&
    typeof value.filename === "string" &&
    value.filename.length > 0 &&
    "dataUrl" in value &&
    typeof value.dataUrl === "string" &&
    BASE64_DATA_URL_PATTERN.test(value.dataUrl)
  );
}

// Saves a chat attachment into the workspace so the agent can read it with its
// tools instead of receiving the whole file in the prompt.
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body: unknown = await request.json().catch(() => null);
  if (!isUploadRequest(body)) {
    return NextResponse.json(
      { error: "workspaceId, filename and a base64 dataUrl are required" },
      { status: 400 },
    );
  }

  const content = Buffer.from(
    body.dataUrl.slice(body.dataUrl.indexOf(",") + 1),
    "base64",
  );
  if (content.byteLength > MAX_FILE_SIZE) {
    return NextResponse.json(
      { error: `File exceeds ${MAX_FILE_SIZE / (1024 * 1024)}MB limit` },
      { status: 413 },
    );
  }

  const [row] = await db
    .select()
    .from(workspaces)
    .where(
      and(
        eq(workspaces.id, body.workspaceId),
        eq(workspaces.userId, session.user.id),
      ),
    );
  if (!row) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  try {
    const uploadPath = await saveWorkspaceUpload(
      getBackend(toWorkspace(row)),
      body.filename,
      content.toString("utf8"),
    );
    return NextResponse.json({
      path: uploadPath,
      sizeBytes: content.byteLength,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to save file to the workspace",
      },
      { status: 500 },
    );
  }
}

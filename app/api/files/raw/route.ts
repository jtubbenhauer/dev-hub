import fs from "node:fs/promises";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db";
import { workspaces } from "@/drizzle/schema";
import { eq, and } from "drizzle-orm";
import { validatePathWithinWorkspace } from "@/lib/files/operations";
import { isPdfPath } from "@/lib/file-preview";

const MAX_RAW_FILE_SIZE = 100 * 1024 * 1024; // 100MB

function pdfResponse(
  bytes: Uint8Array<ArrayBuffer>,
  filePath: string,
): NextResponse {
  const fileName = filePath.split("/").pop() ?? "file.pdf";
  return new NextResponse(bytes, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(bytes.byteLength),
      "Content-Disposition": `inline; filename="${encodeURIComponent(fileName)}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
    },
  });
}

async function readAgentError(response: Response): Promise<string | null> {
  try {
    const body: unknown = await response.json();
    if (typeof body === "object" && body !== null && "error" in body) {
      return typeof body.error === "string" ? body.error : null;
    }
    return null;
  } catch {
    return null;
  }
}

async function fetchRemotePdf(
  agentUrl: string,
  filePath: string,
): Promise<NextResponse> {
  const url = new URL("/files/raw", agentUrl);
  url.searchParams.set("path", filePath);

  let response: Response;
  try {
    response = await fetch(url);
  } catch {
    return NextResponse.json(
      { error: "Could not reach the remote workspace agent" },
      { status: 502 },
    );
  }

  if (!response.ok) {
    const agentError = await readAgentError(response);
    // Agents older than the /files/raw endpoint answer with Hono's plain-text 404.
    if (response.status === 404 && agentError === null) {
      return NextResponse.json(
        {
          error:
            "The remote workspace agent is out of date and cannot serve PDFs. Update and restart the agent.",
        },
        { status: 501 },
      );
    }
    return NextResponse.json(
      { error: agentError ?? "Failed to read remote file" },
      { status: response.status },
    );
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_RAW_FILE_SIZE) {
    return NextResponse.json({ error: "File too large" }, { status: 413 });
  }
  return pdfResponse(bytes, filePath);
}

// GET: stream raw bytes of a previewable binary file (currently PDF only).
// Restricted to PDFs so arbitrary workspace files (e.g. HTML) are never served
// inline from the app origin.
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const searchParams = request.nextUrl.searchParams;
  const workspaceId = searchParams.get("workspaceId");
  const filePath = searchParams.get("path");

  if (!workspaceId || !filePath) {
    return NextResponse.json(
      { error: "workspaceId and path are required" },
      { status: 400 },
    );
  }

  if (!isPdfPath(filePath)) {
    return NextResponse.json(
      { error: "Only PDF files can be previewed" },
      { status: 415 },
    );
  }

  const [row] = await db
    .select()
    .from(workspaces)
    .where(
      and(
        eq(workspaces.id, workspaceId),
        eq(workspaces.userId, session.user.id),
      ),
    );

  if (!row) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  if (row.backend === "remote") {
    if (!row.agentUrl) {
      return NextResponse.json(
        { error: "Remote workspace is missing its agent URL" },
        { status: 500 },
      );
    }
    return fetchRemotePdf(row.agentUrl, filePath);
  }

  let resolvedPath: string;
  try {
    resolvedPath = validatePathWithinWorkspace(row.path, filePath);
  } catch {
    return NextResponse.json(
      { error: "Path traversal denied" },
      { status: 403 },
    );
  }

  try {
    const stat = await fs.stat(resolvedPath);
    if (!stat.isFile()) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }
    if (stat.size > MAX_RAW_FILE_SIZE) {
      return NextResponse.json({ error: "File too large" }, { status: 413 });
    }
    const bytes = await fs.readFile(resolvedPath);
    return pdfResponse(new Uint8Array(bytes), filePath);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }
    return NextResponse.json({ error: "Failed to read file" }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { isNvimInstalled } from "@/lib/terminal/dep-check";

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const action = typeof body.action === "string" ? body.action : null;

  if (action !== "check-deps") {
    return NextResponse.json(
      { error: action ? `Unknown action: ${action}` : "action is required" },
      { status: 400 },
    );
  }

  const nvim = await isNvimInstalled();
  return NextResponse.json({ nvim });
}

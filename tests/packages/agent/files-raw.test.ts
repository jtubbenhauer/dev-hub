// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fileRoutes } from "@/packages/agent/src/routes/files";

const PDF_BYTES = Buffer.from("%PDF-1.4\n\0binary\xff\nend", "latin1");
let workspaceDir: string;

beforeAll(() => {
  workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-raw-"));
  fs.writeFileSync(path.join(workspaceDir, "spec.pdf"), PDF_BYTES);
  fs.mkdirSync(path.join(workspaceDir, "docs"));
});

afterAll(() => {
  fs.rmSync(workspaceDir, { recursive: true, force: true });
});

function getRaw(filePath: string): Promise<Response> {
  const app = fileRoutes(workspaceDir);
  return Promise.resolve(
    app.request(`/raw?path=${encodeURIComponent(filePath)}`),
  );
}

describe("agent GET /files/raw", () => {
  it("returns the file bytes unchanged", async () => {
    const res = await getRaw("spec.pdf");
    expect(res.status).toBe(200);
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.equals(PDF_BYTES)).toBe(true);
  });

  it("returns a JSON 404 for missing files and directories", async () => {
    for (const missing of ["nope.pdf", "docs"]) {
      const res = await getRaw(missing);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "File not found" });
    }
  });

  it("rejects path traversal", async () => {
    const res = await getRaw("../outside.pdf");
    expect(res.status).toBe(403);
  });
});

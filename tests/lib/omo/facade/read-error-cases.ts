import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LocalFsSessionSource } from "@/lib/omo/session-source";
import { encodeCwdDir } from "@/lib/omo/sessions-on-disk";
import { readJson, useReadFixture } from "@/tests/lib/omo/facade/read-fixture";

describe("handleOmoRead errors and health", () => {
  it("rejects OpenCode-style session ids before authorization", async () => {
    // Given
    const fixture = await useReadFixture();

    // When
    const response = await fixture.request("/session/ses_foreign/message");

    // Then
    expect(response.status).toBe(404);
    expect(await readJson(response)).toEqual({
      error: "unsupported_for_engine",
    });
    expect(fixture.source.authorizeSession).not.toHaveBeenCalled();
  });

  it("returns not found when the session cwd is unauthorized", async () => {
    // Given
    const fixture = await useReadFixture();

    // When
    const response = await fixture.request("/session/omo_foreign/message");

    // Then
    expect(response.status).toBe(404);
    expect(fixture.registry.attach).not.toHaveBeenCalled();
  });

  it("rejects a real session header whose cwd belongs to another workspace", async () => {
    // Given
    const tempRoot = await mkdtemp(join(tmpdir(), "omo-read-foreign-"));
    const workspacePath = join(tempRoot, "workspace");
    const foreignPath = join(tempRoot, "foreign");
    const agentDir = join(tempRoot, "agent");
    try {
      await Promise.all([
        mkdir(workspacePath, { recursive: true }),
        mkdir(foreignPath, { recursive: true }),
      ]);
      const sessionsDir = join(
        agentDir,
        "sessions",
        `--${encodeCwdDir(workspacePath)}--`,
      );
      await mkdir(sessionsDir, { recursive: true });
      await writeFile(
        join(sessionsDir, "foreign.jsonl"),
        `${JSON.stringify({
          type: "session",
          version: 3,
          id: "foreign",
          timestamp: "2026-09-28T10:00:00.000Z",
          cwd: foreignPath,
        })}\n`,
        "utf8",
      );
      const localSource = new LocalFsSessionSource({
        agentDir,
        workspacePath,
      });
      const fixture = await useReadFixture();
      fixture.source.authorizeSession.mockImplementation((rawId) =>
        localSource.authorizeSession(rawId),
      );

      // When
      const response = await fixture.request("/session/omo_foreign/message");

      // Then
      expect(response.status).toBe(404);
      expect(fixture.registry.attach).not.toHaveBeenCalled();
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("never falls back to a local session for a remote workspace, even without local mocks matching", async () => {
    // Given (see remote-source.test.ts for full remote-routing coverage)
    const fixture = await useReadFixture();
    const { handleOmoRead } = await import("@/lib/omo/facade/read");

    // When
    const response = await handleOmoRead({
      method: "GET",
      path: "/session/omo_remote/message",
      query: new URLSearchParams(),
      workspace: { ...fixture.workspace, backend: "remote", agentUrl: null },
      userId: "user-1",
    });

    // Then
    expect(response.status).toBe(503);
    expect(await readJson(response)).toEqual({ error: "engine_unavailable" });
    expect(fixture.source.canonicalWorkspacePath).not.toHaveBeenCalled();
    expect(fixture.registry.attach).not.toHaveBeenCalled();
  });

  it("returns Retry-After when opening a session reaches a stopping host", async () => {
    // Given
    const fixture = await useReadFixture();
    const { OmoCommandError } = await import("@/lib/omo/errors");
    fixture.source.authorized.add("busy");
    fixture.registry.attach.mockRejectedValue(
      new OmoCommandError("open_session", "host_stopping", "host_stopping", {
        instanceId: "generation-1",
      }),
    );

    // When
    const response = await fixture.request("/session/omo_busy/message");

    // Then
    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("2");
    expect(await readJson(response)).toEqual({ error: "engine_unavailable" });
  });

  it("lists the workspace's open permission prompts", async () => {
    // Given
    const fixture = await useReadFixture();
    const { DialogLedger } = await import("@/lib/omo/dialog-ledger");
    const ledger = new DialogLedger();
    fixture.runtime.dialogs.set("\u0000devhub-omo-dialog-ledger", ledger);
    const request = {
      sessionID: "omo_root",
      permission: "bash",
      patterns: ["rm -rf build"],
      always: ["rm -rf build"],
      metadata: {},
    };
    const own = ledger.registerPermission({
      routingHandle: "route-root",
      durableId: "root",
      workspaceId: "workspace-1",
      extUiId: "ui-1",
      request,
    });
    ledger.registerPermission({
      routingHandle: "route-other",
      durableId: "other",
      workspaceId: "workspace-2",
      extUiId: "ui-2",
      request,
    });

    // When
    const response = await fixture.request("/permission");

    // Then
    expect(response.status).toBe(200);
    expect(await readJson(response)).toEqual([own.payload]);
  });

  it("reports a healthy connected host", async () => {
    // Given
    const fixture = await useReadFixture();

    // When
    const response = await fixture.request("/global/health");

    // Then
    expect(response.status).toBe(200);
    expect(await readJson(response)).toEqual({
      healthy: true,
      version: "test-host",
    });
  });

  it("reports an unreachable host with 503", async () => {
    // Given
    const fixture = await useReadFixture();
    fixture.client.connect.mockRejectedValue(new Error("offline"));

    // When
    const response = await fixture.request("/global/health");

    // Then
    expect(response.status).toBe(503);
    expect(await readJson(response)).toEqual({ healthy: false });
  });
});

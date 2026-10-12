import { beforeEach, describe, expect, it, vi } from "vitest";

let registry: typeof import("@/lib/lsp/client/workspace-overlay-registry");

function fakeRegistration() {
  return { dispose: vi.fn() };
}

function target(workspaceId: string, workspaceRoot: string) {
  return { workspaceId, workspaceRoot };
}

beforeEach(async () => {
  vi.resetModules();
  registry = await import("@/lib/lsp/client/workspace-overlay-registry");
});

describe("workspace file overlay registry", () => {
  it("registers a workspace overlay once and reuses it for later sessions", () => {
    const registration = fakeRegistration();
    const register = vi.fn(() => registration);

    registry.ensureWorkspaceFileOverlay(target("ws-a", "/repo/a"), register);
    registry.ensureWorkspaceFileOverlay(target("ws-a", "/repo/a"), register);

    expect(register).toHaveBeenCalledOnce();
    expect(registration.dispose).not.toHaveBeenCalled();
  });

  it("keeps overlays of different workspace roots registered side by side", () => {
    const registrationA = fakeRegistration();
    const registrationB = fakeRegistration();

    registry.ensureWorkspaceFileOverlay(
      target("ws-a", "/repo/a"),
      () => registrationA,
    );
    registry.ensureWorkspaceFileOverlay(
      target("ws-b", "/repo/b"),
      () => registrationB,
    );

    expect(registrationA.dispose).not.toHaveBeenCalled();
    expect(registrationB.dispose).not.toHaveBeenCalled();
  });

  it("replaces the overlay when the same root returns with another workspace id", () => {
    const staleRegistration = fakeRegistration();
    const freshRegistration = fakeRegistration();
    const registerFresh = vi.fn(() => freshRegistration);

    registry.ensureWorkspaceFileOverlay(
      target("ws-old", "/repo/a"),
      () => staleRegistration,
    );
    registry.ensureWorkspaceFileOverlay(
      target("ws-new", "/repo/a"),
      registerFresh,
    );

    expect(staleRegistration.dispose).toHaveBeenCalledOnce();
    expect(registerFresh).toHaveBeenCalledOnce();
    expect(freshRegistration.dispose).not.toHaveBeenCalled();
  });

  it("unregisters the least recently used overlay beyond the cap", () => {
    const registrations = Array.from(
      { length: registry.MAX_RETAINED_WORKSPACE_OVERLAYS + 1 },
      fakeRegistration,
    );
    const ensureIndex = (index: number) =>
      registry.ensureWorkspaceFileOverlay(
        target(`ws-${index}`, `/repo/${index}`),
        () => registrations[index],
      );
    for (let index = 0; index < registrations.length - 1; index++) {
      ensureIndex(index);
    }
    ensureIndex(0);

    ensureIndex(registrations.length - 1);

    expect(registrations[1].dispose).toHaveBeenCalledOnce();
    expect(
      registrations.filter(
        (registration) => registration.dispose.mock.calls.length > 0,
      ),
    ).toHaveLength(1);
  });

  it("registers again after a failed registration", () => {
    const registration = fakeRegistration();
    const register = vi
      .fn<() => { dispose(): void }>()
      .mockImplementationOnce(() => {
        throw new Error("overlay failed");
      })
      .mockImplementationOnce(() => registration);

    expect(() =>
      registry.ensureWorkspaceFileOverlay(target("ws-a", "/repo/a"), register),
    ).toThrow("overlay failed");
    registry.ensureWorkspaceFileOverlay(target("ws-a", "/repo/a"), register);

    expect(register).toHaveBeenCalledTimes(2);
    expect(registration.dispose).not.toHaveBeenCalled();
  });
});

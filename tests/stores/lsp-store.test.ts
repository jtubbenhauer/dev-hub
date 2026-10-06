import { describe, it, expect, beforeEach } from "vitest";
import { useLspStore } from "@/stores/lsp-store";

const initialState = useLspStore.getState();

describe("useLspStore", () => {
  beforeEach(() => {
    useLspStore.setState(initialState, true);
  });

  it("starts disabled with no session", () => {
    const state = useLspStore.getState();
    expect(state.status).toBe("disabled");
    expect(state.errorMessage).toBeNull();
    expect(state.serverEpoch).toBeNull();
    expect(state.sessionWorkspaceId).toBeNull();
    expect(state.isMonacoRegistered).toBe(false);
    expect(state.documentOwners).toEqual({});
    expect(state.retryNonce).toBe(0);
  });

  it("is not persisted", () => {
    expect((useLspStore as unknown as { persist?: unknown }).persist).toBe(
      undefined,
    );
  });

  it("setStatus stores the error message when given", () => {
    useLspStore.getState().setStatus("error", "boom");
    expect(useLspStore.getState().status).toBe("error");
    expect(useLspStore.getState().errorMessage).toBe("boom");
  });

  it("setStatus clears the error message when none is given", () => {
    useLspStore.getState().setStatus("error", "boom");
    useLspStore.getState().setStatus("connected");
    expect(useLspStore.getState().status).toBe("connected");
    expect(useLspStore.getState().errorMessage).toBeNull();
  });

  it("setSession records workspace and epoch", () => {
    useLspStore.getState().setSession("ws-1", 3);
    expect(useLspStore.getState().sessionWorkspaceId).toBe("ws-1");
    expect(useLspStore.getState().serverEpoch).toBe(3);
    useLspStore.getState().setSession(null, null);
    expect(useLspStore.getState().sessionWorkspaceId).toBeNull();
    expect(useLspStore.getState().serverEpoch).toBeNull();
  });

  it("markMonacoRegistered sets the flag", () => {
    useLspStore.getState().markMonacoRegistered();
    expect(useLspStore.getState().isMonacoRegistered).toBe(true);
  });

  it("claimDocument succeeds on a free document", () => {
    expect(
      useLspStore.getState().claimDocument("file:///a.ts", "owner-1"),
    ).toBe(true);
    expect(useLspStore.getState().documentOwners["file:///a.ts"]).toBe(
      "owner-1",
    );
  });

  it("claimDocument is idempotent for the same owner", () => {
    useLspStore.getState().claimDocument("file:///a.ts", "owner-1");
    expect(
      useLspStore.getState().claimDocument("file:///a.ts", "owner-1"),
    ).toBe(true);
  });

  it("claimDocument refuses a second owner and keeps the first", () => {
    useLspStore.getState().claimDocument("file:///a.ts", "owner-1");
    expect(
      useLspStore.getState().claimDocument("file:///a.ts", "owner-2"),
    ).toBe(false);
    expect(useLspStore.getState().documentOwners["file:///a.ts"]).toBe(
      "owner-1",
    );
  });

  it("releaseDocument by a non-owner is ignored", () => {
    useLspStore.getState().claimDocument("file:///a.ts", "owner-1");
    useLspStore.getState().releaseDocument("file:///a.ts", "owner-2");
    expect(useLspStore.getState().documentOwners["file:///a.ts"]).toBe(
      "owner-1",
    );
  });

  it("releaseDocument by the owner frees the document for others", () => {
    useLspStore.getState().claimDocument("file:///a.ts", "owner-1");
    useLspStore.getState().releaseDocument("file:///a.ts", "owner-1");
    expect(useLspStore.getState().documentOwners).toEqual({});
    expect(
      useLspStore.getState().claimDocument("file:///a.ts", "owner-2"),
    ).toBe(true);
  });

  it("requestRetry increments retryNonce each call", () => {
    useLspStore.getState().requestRetry();
    useLspStore.getState().requestRetry();
    expect(useLspStore.getState().retryNonce).toBe(2);
  });
});

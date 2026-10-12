import { describe, expect, it, vi } from "vitest";
import { createSessionFixture } from "./lsp-session-fixture";
import {
  trackBuiltinTs,
  suppressBuiltinTypeScriptFeatures,
  restoreBuiltinTypeScriptFeatures,
} from "@/lib/lsp/client/builtin-typescript";

describe("built-in worker reset ownership", () => {
  it("resets once after providers are removed, without resetting on restore", () => {
    // Given
    const fixture = createSessionFixture();
    const stopWorkers = vi.fn(() => expect(fixture.registrations.size).toBe(0));
    trackBuiltinTs(fixture.monaco, stopWorkers);
    fixture.languages.registerHoverProvider("typescript", {});
    // When
    suppressBuiltinTypeScriptFeatures(fixture.monaco);
    suppressBuiltinTypeScriptFeatures(fixture.monaco);
    restoreBuiltinTypeScriptFeatures(fixture.monaco);
    // Then
    expect(stopWorkers).toHaveBeenCalledOnce();
    expect(fixture.registrations.size).toBe(1);
  });
});

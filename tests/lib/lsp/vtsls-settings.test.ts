import { describe, expect, it } from "vitest";
import { VTSLS_SETTINGS, getSettingsSection } from "@/lib/lsp/vtsls-settings";

describe("getSettingsSection", () => {
  it("returns the whole object for undefined or empty section", () => {
    expect(getSettingsSection(undefined)).toBe(VTSLS_SETTINGS);
    expect(getSettingsSection("")).toBe(VTSLS_SETTINGS);
  });

  it("resolves dotted paths", () => {
    expect(
      getSettingsSection("typescript.inlayHints.parameterNames.enabled"),
    ).toBe("literals");
    expect(
      getSettingsSection("vtsls.experimental.completion.entriesLimit"),
    ).toBe(50);
    expect(getSettingsSection("typescript.format")).toEqual({ enable: true });
  });

  it("returns null for missing sections", () => {
    expect(getSettingsSection("nope")).toBeNull();
    expect(getSettingsSection("typescript.nope.deeper")).toBeNull();
    expect(getSettingsSection("typescript.format.enable.deeper")).toBeNull();
    expect(getSettingsSection("typescript.constructor")).toBeNull();
  });

  it("shares inlay hint settings between typescript and javascript", () => {
    expect(getSettingsSection("javascript.inlayHints")).toEqual(
      getSettingsSection("typescript.inlayHints"),
    );
  });

  it("caps vtsls completion lists at 50 entries with server-side fuzzy match", () => {
    expect(VTSLS_SETTINGS.vtsls.experimental.completion).toEqual({
      enableServerSideFuzzyMatch: true,
      entriesLimit: 50,
    });
    expect(getSettingsSection("vtsls.experimental.completion")).toEqual({
      enableServerSideFuzzyMatch: true,
      entriesLimit: 50,
    });
  });
});

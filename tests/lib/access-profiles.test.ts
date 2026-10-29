import { describe, it, expect } from "vitest";
import {
  formatAccessTimeRemaining,
  isValidAccessProfileId,
  parseAccessOptions,
  readWorkspaceAccess,
  shellQuote,
} from "@/lib/workspaces/access-profiles";
import { execFileSync } from "node:child_process";

describe("parseAccessOptions", () => {
  it("reads profiles from the provider's JSON output", () => {
    const options = parseAccessOptions({
      profiles: [
        {
          id: "dev-ops",
          label: "Dev: logs and metadata",
          description: "Read-only",
          eligible: true,
        },
        {
          id: "prod-data",
          label: "Prod: read Firestore data",
          eligible: false,
          ineligibleReason: "Ask for access to rig-gated@",
          gated: { ttlHours: 4, reasonRequired: true },
        },
      ],
    });

    expect(options).toEqual([
      {
        id: "dev-ops",
        label: "Dev: logs and metadata",
        description: "Read-only",
        isEligible: true,
        ineligibleReason: undefined,
        isReasonRequired: false,
        gate: undefined,
      },
      {
        id: "prod-data",
        label: "Prod: read Firestore data",
        description: undefined,
        isEligible: false,
        ineligibleReason: "Ask for access to rig-gated@",
        isReasonRequired: true,
        gate: { ttlHours: 4, isReasonRequired: true },
      },
    ]);
  });

  it("requires a reason for a profile that asks for one without a time limit", () => {
    const [option] = parseAccessOptions([
      {
        id: "prod-ops",
        label: "Prod: debugging",
        eligible: true,
        reasonRequired: true,
      },
    ]);
    expect(option.isReasonRequired).toBe(true);
    expect(option.gate).toBeUndefined();
  });

  it("accepts a bare array of profiles", () => {
    const options = parseAccessOptions([
      { id: "dev-ops", label: "Dev ops", eligible: true },
    ]);
    expect(options.map((option) => option.id)).toEqual(["dev-ops"]);
  });

  it.each([
    ["missing label", { id: "dev-ops", eligible: true }],
    ["id with shell characters", { id: "dev-ops;rm", label: "x" }],
    ["the reserved none id", { id: "none", label: "No access" }],
    ["non-object entry", "dev-ops"],
  ])("drops entries with %s", (_description, entry) => {
    expect(parseAccessOptions({ profiles: [entry] })).toEqual([]);
  });

  it("treats a missing eligible flag as not eligible", () => {
    const [option] = parseAccessOptions([{ id: "dev-ops", label: "Dev ops" }]);
    expect(option.isEligible).toBe(false);
  });

  it("ignores a gate without a positive ttl", () => {
    const [option] = parseAccessOptions([
      {
        id: "prod-data",
        label: "Prod data",
        eligible: true,
        gated: { ttlHours: 0 },
      },
    ]);
    expect(option.gate).toBeUndefined();
  });

  it.each([null, "text", { profiles: "nope" }, 42])(
    "returns no options for malformed output %#",
    (raw) => {
      expect(parseAccessOptions(raw)).toEqual([]);
    },
  );
});

describe("isValidAccessProfileId", () => {
  it.each([
    ["none", true],
    ["dev-ops", true],
    ["prod-data", true],
    ["prod", false],
    ["Dev-Ops", false],
    ["dev-ops; rm -rf /", false],
    ["", false],
  ])("%s -> %s", (profileId, expected) => {
    expect(isValidAccessProfileId(profileId)).toBe(expected);
  });
});

describe("shellQuote", () => {
  it.each([
    "Investigating the Wattlebird Example Dental invoice bug",
    "it's urgent",
    "$(touch /tmp/pwned) `whoami` ; echo hi",
    "",
  ])("passes %j through sh unchanged", (value) => {
    const echoed = execFileSync("sh", ["-c", `printf %s ${shellQuote(value)}`])
      .toString()
      .trim();
    expect(echoed).toBe(value.trim());
  });
});

describe("readWorkspaceAccess", () => {
  it("reads the access recorded on a workspace", () => {
    expect(
      readWorkspaceAccess({
        providerId: "rig",
        access: {
          profile: "prod-data",
          reason: "Investigating a claim",
          expiresAt: "2026-10-29T05:00:00.000Z",
        },
      }),
    ).toEqual({
      profile: "prod-data",
      reason: "Investigating a claim",
      expiresAt: "2026-10-29T05:00:00.000Z",
    });
  });

  it.each([
    ["no provider meta", null],
    ["no access", { providerId: "rig" }],
    ["no-access profile", { access: { profile: "none" } }],
    ["malformed access", { access: "dev-ops" }],
  ])("returns null for %s", (_description, providerMeta) => {
    expect(readWorkspaceAccess(providerMeta)).toBeNull();
  });
});

describe("formatAccessTimeRemaining", () => {
  const now = new Date("2026-10-29T01:00:00.000Z");

  it.each([
    ["2026-10-29T04:12:30.000Z", "3h 12m left"],
    ["2026-10-29T01:45:00.000Z", "45m left"],
    ["2026-10-29T01:00:00.000Z", "expired"],
    ["2026-10-28T23:00:00.000Z", "expired"],
    ["not a date", "unknown expiry"],
  ])("%s -> %s", (expiresAt, expected) => {
    expect(formatAccessTimeRemaining(expiresAt, now)).toBe(expected);
  });
});

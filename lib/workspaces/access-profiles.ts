import type {
  ProviderAccessGate,
  ProviderAccessOption,
  WorkspaceAccess,
} from "@/types";

export const NO_ACCESS_PROFILE_ID = "none";

const ACCESS_PROFILE_ID_PATTERN = /^[a-z]+-[a-z]+$/;

export function isValidAccessProfileId(profileId: string): boolean {
  return (
    profileId === NO_ACCESS_PROFILE_ID ||
    ACCESS_PROFILE_ID_PATTERN.test(profileId)
  );
}

// Provider commands run through `sh -c`, so free text must be single-quoted.
export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function parseGate(raw: unknown): ProviderAccessGate | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const gate = raw as Record<string, unknown>;
  if (typeof gate.ttlHours !== "number" || gate.ttlHours <= 0) {
    return undefined;
  }
  return {
    ttlHours: gate.ttlHours,
    isReasonRequired: gate.reasonRequired === true,
  };
}

function parseAccessOption(raw: unknown): ProviderAccessOption | null {
  if (!raw || typeof raw !== "object") return null;
  const option = raw as Record<string, unknown>;
  if (typeof option.id !== "string" || typeof option.label !== "string") {
    return null;
  }
  if (
    option.id === NO_ACCESS_PROFILE_ID ||
    !isValidAccessProfileId(option.id)
  ) {
    return null;
  }
  const gate = parseGate(option.gated);
  return {
    id: option.id,
    label: option.label,
    description:
      typeof option.description === "string" ? option.description : undefined,
    isEligible: option.eligible === true,
    ineligibleReason:
      typeof option.ineligibleReason === "string"
        ? option.ineligibleReason
        : undefined,
    isReasonRequired:
      option.reasonRequired === true || gate?.isReasonRequired === true,
    gate,
  };
}

export function parseAccessOptions(raw: unknown): ProviderAccessOption[] {
  const profiles =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>).profiles
      : raw;
  if (!Array.isArray(profiles)) return [];
  return profiles
    .map(parseAccessOption)
    .filter((option): option is ProviderAccessOption => option !== null);
}

export function readWorkspaceAccess(
  providerMeta: Record<string, unknown> | null | undefined,
): WorkspaceAccess | null {
  const access = providerMeta?.access;
  if (!access || typeof access !== "object") return null;
  const record = access as Record<string, unknown>;
  if (
    typeof record.profile !== "string" ||
    record.profile === NO_ACCESS_PROFILE_ID
  ) {
    return null;
  }
  return {
    profile: record.profile,
    reason: typeof record.reason === "string" ? record.reason : undefined,
    expiresAt:
      typeof record.expiresAt === "string" ? record.expiresAt : undefined,
  };
}

export function formatAccessTimeRemaining(
  expiresAt: string,
  now: Date,
): string {
  const expiryTime = new Date(expiresAt).getTime();
  if (Number.isNaN(expiryTime)) return "unknown expiry";
  const remainingMinutes = Math.floor((expiryTime - now.getTime()) / 60_000);
  if (remainingMinutes <= 0) return "expired";
  const hours = Math.floor(remainingMinutes / 60);
  const minutes = remainingMinutes % 60;
  if (hours === 0) return `${minutes}m left`;
  return `${hours}h ${minutes}m left`;
}

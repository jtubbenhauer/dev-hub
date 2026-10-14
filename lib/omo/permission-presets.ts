export const OMO_PERMISSION_PRESETS = [
  "ask",
  "auto",
  "accept-edits",
  "read-only",
  "workspace",
  "full-access",
] as const;

export type OmoPermissionPreset = (typeof OMO_PERMISSION_PRESETS)[number];

export function isOmoPermissionPreset(
  value: unknown,
): value is OmoPermissionPreset {
  return (
    typeof value === "string" &&
    (OMO_PERMISSION_PRESETS as readonly string[]).includes(value)
  );
}

export const OMO_PERMISSION_PRESET_DETAILS: Readonly<
  Record<
    OmoPermissionPreset,
    { readonly label: string; readonly description: string }
  >
> = {
  ask: {
    label: "Ask",
    description: "Ask before any tool call that isn't explicitly allowed.",
  },
  auto: {
    label: "Auto",
    description:
      "Allow reads, edits and safe commands inside the project. Ask for everything else.",
  },
  "accept-edits": {
    label: "Accept edits",
    description:
      "Allow reading and editing project files. Ask before commands and other tools.",
  },
  "read-only": {
    label: "Read only",
    description: "Allow reading and searching. Ask before edits and commands.",
  },
  workspace: {
    label: "Workspace",
    description:
      "Allow reads, edits and commands. Ask before touching files outside the project.",
  },
  "full-access": {
    label: "Full access",
    description: "Never ask. omo uses this unless its settings say otherwise.",
  },
};

export const OMO_PERMISSION_PRESET_CAPABILITIES: Readonly<
  Partial<Record<OmoPermissionPreset, string>>
> = {
  auto: "permission_preset_auto",
  "accept-edits": "permission_preset_accept_edits",
};

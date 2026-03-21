import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { SoundSettingsCard } from "@/components/settings/general-settings";

const mockMutate = vi.fn();

vi.mock("@/hooks/use-settings", () => ({
  useSoundSettings: vi.fn(() => ({
    agentEnabled: false,
    agentSoundId: "staplebops-01",
    permissionsEnabled: false,
    permissionsSoundId: "staplebops-02",
    errorsEnabled: false,
    errorsSoundId: "nope-03",
    isLoading: false,
  })),
  useSettingsMutation: vi.fn(() => ({
    mutate: mockMutate,
    isPending: false,
  })),
  SETTINGS_KEYS: {
    SOUND_AGENT_ENABLED: "sound-agent-enabled",
    SOUND_AGENT_ID: "sound-agent-id",
    SOUND_PERMISSIONS_ENABLED: "sound-permissions-enabled",
    SOUND_PERMISSIONS_ID: "sound-permissions-id",
    SOUND_ERRORS_ENABLED: "sound-errors-enabled",
    SOUND_ERRORS_ID: "sound-errors-id",
  },
}));

vi.mock("@/lib/sounds", () => ({
  SOUND_OPTIONS: [
    {
      id: "alert-01",
      label: "Alert 1",
      category: "alerts",
      filename: "alert-01.aac",
    },
    {
      id: "bip-bop-01",
      label: "Bip Bop 1",
      category: "bip-bops",
      filename: "bip-bop-01.aac",
    },
    {
      id: "staplebops-01",
      label: "Staplebops 1",
      category: "staplebops",
      filename: "staplebops-01.aac",
    },
    {
      id: "nope-01",
      label: "Nope 1",
      category: "nopes",
      filename: "nope-01.aac",
    },
    { id: "yup-01", label: "Yup 1", category: "yups", filename: "yup-01.aac" },
  ],
  playSound: vi.fn(),
  soundSrc: vi.fn((id: string) => `/sounds/${id}.aac`),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SoundSettingsCard", () => {
  it("renders card with title Sound Effects", () => {
    render(<SoundSettingsCard />);
    expect(screen.getByText("Sound Effects")).toBeInTheDocument();
  });

  it("renders description text", () => {
    render(<SoundSettingsCard />);
    expect(
      screen.getByText("Configure notification sounds for different events."),
    ).toBeInTheDocument();
  });

  it("renders Agent, Permissions, and Errors row labels", () => {
    render(<SoundSettingsCard />);
    expect(screen.getByText("Agent")).toBeInTheDocument();
    expect(screen.getByText("Permissions")).toBeInTheDocument();
    expect(screen.getByText("Errors")).toBeInTheDocument();
  });

  it("renders row descriptions", () => {
    render(<SoundSettingsCard />);
    expect(
      screen.getByText(
        "Play sound when the agent completes or needs attention",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Play sound when a permission is required"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Play sound when an error occurs"),
    ).toBeInTheDocument();
  });

  it("renders 3 select triggers", () => {
    render(<SoundSettingsCard />);
    const combos = screen.getAllByRole("combobox");
    expect(combos).toHaveLength(3);
  });

  it("shows loading spinner while isLoading is true", async () => {
    const { useSoundSettings } = await import("@/hooks/use-settings");
    vi.mocked(useSoundSettings).mockReturnValueOnce({
      agentEnabled: false,
      agentSoundId: "staplebops-01",
      permissionsEnabled: false,
      permissionsSoundId: "staplebops-02",
      errorsEnabled: false,
      errorsSoundId: "nope-03",
      isLoading: true,
    });
    render(<SoundSettingsCard />);
    expect(document.querySelector(".animate-spin")).toBeInTheDocument();
    expect(screen.queryByText("Sound Effects")).not.toBeInTheDocument();
  });

  it("selects are disabled while mutation is pending", async () => {
    const { useSettingsMutation } = await import("@/hooks/use-settings");
    vi.mocked(useSettingsMutation).mockReturnValueOnce({
      mutate: mockMutate,
      isPending: true,
    } as unknown as ReturnType<typeof useSettingsMutation>);
    render(<SoundSettingsCard />);
    const combos = screen.getAllByRole("combobox");
    for (const combo of combos) {
      expect(combo).toBeDisabled();
    }
  });
});

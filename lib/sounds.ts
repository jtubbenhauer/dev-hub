// Zero-React sound utility module — pure utilities for sound management
// No React, Zustand, or TanStack imports

export const SOUND_OPTIONS = [
  // alerts (10)
  {
    id: "alert-01",
    label: "Alert 1",
    category: "alerts" as const,
    filename: "alert-01.aac",
  },
  {
    id: "alert-02",
    label: "Alert 2",
    category: "alerts" as const,
    filename: "alert-02.aac",
  },
  {
    id: "alert-03",
    label: "Alert 3",
    category: "alerts" as const,
    filename: "alert-03.aac",
  },
  {
    id: "alert-04",
    label: "Alert 4",
    category: "alerts" as const,
    filename: "alert-04.aac",
  },
  {
    id: "alert-05",
    label: "Alert 5",
    category: "alerts" as const,
    filename: "alert-05.aac",
  },
  {
    id: "alert-06",
    label: "Alert 6",
    category: "alerts" as const,
    filename: "alert-06.aac",
  },
  {
    id: "alert-07",
    label: "Alert 7",
    category: "alerts" as const,
    filename: "alert-07.aac",
  },
  {
    id: "alert-08",
    label: "Alert 8",
    category: "alerts" as const,
    filename: "alert-08.aac",
  },
  {
    id: "alert-09",
    label: "Alert 9",
    category: "alerts" as const,
    filename: "alert-09.aac",
  },
  {
    id: "alert-10",
    label: "Alert 10",
    category: "alerts" as const,
    filename: "alert-10.aac",
  },
  // bip-bops (10)
  {
    id: "bip-bop-01",
    label: "Bip Bop 1",
    category: "bip-bops" as const,
    filename: "bip-bop-01.aac",
  },
  {
    id: "bip-bop-02",
    label: "Bip Bop 2",
    category: "bip-bops" as const,
    filename: "bip-bop-02.aac",
  },
  {
    id: "bip-bop-03",
    label: "Bip Bop 3",
    category: "bip-bops" as const,
    filename: "bip-bop-03.aac",
  },
  {
    id: "bip-bop-04",
    label: "Bip Bop 4",
    category: "bip-bops" as const,
    filename: "bip-bop-04.aac",
  },
  {
    id: "bip-bop-05",
    label: "Bip Bop 5",
    category: "bip-bops" as const,
    filename: "bip-bop-05.aac",
  },
  {
    id: "bip-bop-06",
    label: "Bip Bop 6",
    category: "bip-bops" as const,
    filename: "bip-bop-06.aac",
  },
  {
    id: "bip-bop-07",
    label: "Bip Bop 7",
    category: "bip-bops" as const,
    filename: "bip-bop-07.aac",
  },
  {
    id: "bip-bop-08",
    label: "Bip Bop 8",
    category: "bip-bops" as const,
    filename: "bip-bop-08.aac",
  },
  {
    id: "bip-bop-09",
    label: "Bip Bop 9",
    category: "bip-bops" as const,
    filename: "bip-bop-09.aac",
  },
  {
    id: "bip-bop-10",
    label: "Bip Bop 10",
    category: "bip-bops" as const,
    filename: "bip-bop-10.aac",
  },
  // staplebops (7)
  {
    id: "staplebops-01",
    label: "Staplebops 1",
    category: "staplebops" as const,
    filename: "staplebops-01.aac",
  },
  {
    id: "staplebops-02",
    label: "Staplebops 2",
    category: "staplebops" as const,
    filename: "staplebops-02.aac",
  },
  {
    id: "staplebops-03",
    label: "Staplebops 3",
    category: "staplebops" as const,
    filename: "staplebops-03.aac",
  },
  {
    id: "staplebops-04",
    label: "Staplebops 4",
    category: "staplebops" as const,
    filename: "staplebops-04.aac",
  },
  {
    id: "staplebops-05",
    label: "Staplebops 5",
    category: "staplebops" as const,
    filename: "staplebops-05.aac",
  },
  {
    id: "staplebops-06",
    label: "Staplebops 6",
    category: "staplebops" as const,
    filename: "staplebops-06.aac",
  },
  {
    id: "staplebops-07",
    label: "Staplebops 7",
    category: "staplebops" as const,
    filename: "staplebops-07.aac",
  },
  // nopes (12)
  {
    id: "nope-01",
    label: "Nope 1",
    category: "nopes" as const,
    filename: "nope-01.aac",
  },
  {
    id: "nope-02",
    label: "Nope 2",
    category: "nopes" as const,
    filename: "nope-02.aac",
  },
  {
    id: "nope-03",
    label: "Nope 3",
    category: "nopes" as const,
    filename: "nope-03.aac",
  },
  {
    id: "nope-04",
    label: "Nope 4",
    category: "nopes" as const,
    filename: "nope-04.aac",
  },
  {
    id: "nope-05",
    label: "Nope 5",
    category: "nopes" as const,
    filename: "nope-05.aac",
  },
  {
    id: "nope-06",
    label: "Nope 6",
    category: "nopes" as const,
    filename: "nope-06.aac",
  },
  {
    id: "nope-07",
    label: "Nope 7",
    category: "nopes" as const,
    filename: "nope-07.aac",
  },
  {
    id: "nope-08",
    label: "Nope 8",
    category: "nopes" as const,
    filename: "nope-08.aac",
  },
  {
    id: "nope-09",
    label: "Nope 9",
    category: "nopes" as const,
    filename: "nope-09.aac",
  },
  {
    id: "nope-10",
    label: "Nope 10",
    category: "nopes" as const,
    filename: "nope-10.aac",
  },
  {
    id: "nope-11",
    label: "Nope 11",
    category: "nopes" as const,
    filename: "nope-11.aac",
  },
  {
    id: "nope-12",
    label: "Nope 12",
    category: "nopes" as const,
    filename: "nope-12.aac",
  },
  // yups (6)
  {
    id: "yup-01",
    label: "Yup 1",
    category: "yups" as const,
    filename: "yup-01.aac",
  },
  {
    id: "yup-02",
    label: "Yup 2",
    category: "yups" as const,
    filename: "yup-02.aac",
  },
  {
    id: "yup-03",
    label: "Yup 3",
    category: "yups" as const,
    filename: "yup-03.aac",
  },
  {
    id: "yup-04",
    label: "Yup 4",
    category: "yups" as const,
    filename: "yup-04.aac",
  },
  {
    id: "yup-05",
    label: "Yup 5",
    category: "yups" as const,
    filename: "yup-05.aac",
  },
  {
    id: "yup-06",
    label: "Yup 6",
    category: "yups" as const,
    filename: "yup-06.aac",
  },
] as const;

export type SoundID = (typeof SOUND_OPTIONS)[number]["id"];
export type SoundEventType = "agent" | "permissions" | "errors";

export interface SoundSettings {
  globalSoundEnabled: boolean;
  agentEnabled: boolean;
  agentSoundId: string;
  permissionsEnabled: boolean;
  permissionsSoundId: string;
  errorsEnabled: boolean;
  errorsSoundId: string;
}

export const DEFAULT_SOUND_SETTINGS: SoundSettings = {
  globalSoundEnabled: true,
  agentEnabled: false,
  agentSoundId: "staplebops-01",
  permissionsEnabled: false,
  permissionsSoundId: "staplebops-02",
  errorsEnabled: false,
  errorsSoundId: "nope-03",
};

let cachedSettings: SoundSettings = { ...DEFAULT_SOUND_SETTINGS };

export function updateSoundSettings(settings: SoundSettings): void {
  cachedSettings = settings;
}

export function getSoundSettings(): SoundSettings {
  return cachedSettings;
}

export function soundSrc(id: string | undefined): string | undefined {
  if (!id) return undefined;
  const option = SOUND_OPTIONS.find((o) => o.id === id);
  if (!option) return undefined;
  return `/sounds/${option.filename}`;
}

export function playSound(src: string | undefined): (() => void) | undefined {
  if (typeof Audio === "undefined" || !src) return undefined;
  const audio = new Audio(src);
  audio.play().catch(() => undefined);
  return () => {
    audio.pause();
    audio.currentTime = 0;
  };
}

export function playSoundForEvent(event: SoundEventType): void {
  const settings = cachedSettings;
  if (!settings.globalSoundEnabled) return;
  if (event === "agent" && settings.agentEnabled) {
    playSound(soundSrc(settings.agentSoundId));
  } else if (event === "permissions" && settings.permissionsEnabled) {
    playSound(soundSrc(settings.permissionsSoundId));
  } else if (event === "errors" && settings.errorsEnabled) {
    playSound(soundSrc(settings.errorsSoundId));
  }
}

"use client";

import { useEffect } from "react";
import { useSoundSettings } from "@/hooks/use-settings";
import { updateSoundSettings } from "@/lib/sounds";

export function SoundSettingsSync() {
  const {
    agentEnabled,
    agentSoundId,
    permissionsEnabled,
    permissionsSoundId,
    errorsEnabled,
    errorsSoundId,
  } = useSoundSettings();

  useEffect(() => {
    updateSoundSettings({
      agentEnabled,
      agentSoundId,
      permissionsEnabled,
      permissionsSoundId,
      errorsEnabled,
      errorsSoundId,
    });
  }, [
    agentEnabled,
    agentSoundId,
    permissionsEnabled,
    permissionsSoundId,
    errorsEnabled,
    errorsSoundId,
  ]);

  return null;
}

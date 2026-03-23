"use client";

import { useEffect } from "react";
import {
  useSoundSettings,
  useNotificationSettings,
} from "@/hooks/use-settings";
import { updateSoundSettings } from "@/lib/sounds";
import { updatePushNotificationEnabled } from "@/lib/notifications";

export function SoundSettingsSync() {
  const {
    agentEnabled,
    agentSoundId,
    permissionsEnabled,
    permissionsSoundId,
    errorsEnabled,
    errorsSoundId,
  } = useSoundSettings();
  const { isSoundEnabled, isPushEnabled } = useNotificationSettings();

  useEffect(() => {
    updateSoundSettings({
      globalSoundEnabled: isSoundEnabled,
      agentEnabled,
      agentSoundId,
      permissionsEnabled,
      permissionsSoundId,
      errorsEnabled,
      errorsSoundId,
    });
  }, [
    isSoundEnabled,
    agentEnabled,
    agentSoundId,
    permissionsEnabled,
    permissionsSoundId,
    errorsEnabled,
    errorsSoundId,
  ]);

  useEffect(() => {
    updatePushNotificationEnabled(isPushEnabled);
  }, [isPushEnabled]);

  return null;
}

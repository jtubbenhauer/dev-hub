import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  SOUND_OPTIONS,
  DEFAULT_SOUND_SETTINGS,
  soundSrc,
  playSound,
  playSoundForEvent,
  updateSoundSettings,
  getSoundSettings,
  type SoundSettings,
} from "@/lib/sounds";

describe("sounds", () => {
  describe("SOUND_OPTIONS", () => {
    it("contains exactly 45 entries", () => {
      expect(SOUND_OPTIONS).toHaveLength(45);
    });

    it("has 10 alert sounds", () => {
      const alerts = SOUND_OPTIONS.filter((o) => o.category === "alerts");
      expect(alerts).toHaveLength(10);
      expect(alerts.map((o) => o.id)).toEqual([
        "alert-01",
        "alert-02",
        "alert-03",
        "alert-04",
        "alert-05",
        "alert-06",
        "alert-07",
        "alert-08",
        "alert-09",
        "alert-10",
      ]);
    });

    it("has 10 bip-bop sounds", () => {
      const bipBops = SOUND_OPTIONS.filter((o) => o.category === "bip-bops");
      expect(bipBops).toHaveLength(10);
    });

    it("has 7 staplebops sounds", () => {
      const staplebops = SOUND_OPTIONS.filter(
        (o) => o.category === "staplebops",
      );
      expect(staplebops).toHaveLength(7);
    });

    it("has 12 nope sounds", () => {
      const nopes = SOUND_OPTIONS.filter((o) => o.category === "nopes");
      expect(nopes).toHaveLength(12);
    });

    it("has 6 yup sounds", () => {
      const yups = SOUND_OPTIONS.filter((o) => o.category === "yups");
      expect(yups).toHaveLength(6);
    });
  });

  describe("soundSrc", () => {
    it("returns correct path for alert-01", () => {
      expect(soundSrc("alert-01")).toBe("/sounds/alert-01.aac");
    });

    it("returns correct path for yup-06", () => {
      expect(soundSrc("yup-06")).toBe("/sounds/yup-06.aac");
    });

    it("returns undefined for nonexistent sound ID", () => {
      expect(soundSrc("nonexistent")).toBeUndefined();
    });

    it("returns undefined for undefined input", () => {
      expect(soundSrc(undefined)).toBeUndefined();
    });

    it("returns undefined for empty string", () => {
      expect(soundSrc("")).toBeUndefined();
    });
  });

  describe("playSound", () => {
    let mockAudioInstance: {
      play: ReturnType<typeof vi.fn>;
      pause: ReturnType<typeof vi.fn>;
      currentTime: number;
    };

    beforeEach(() => {
      mockAudioInstance = {
        play: vi.fn().mockResolvedValue(undefined),
        pause: vi.fn(),
        currentTime: 0,
      };
      const AudioConstructor = vi.fn(function (this: typeof mockAudioInstance) {
        this.play = mockAudioInstance.play;
        this.pause = mockAudioInstance.pause;
        this.currentTime = mockAudioInstance.currentTime;
      }) as unknown as typeof Audio;
      vi.stubGlobal("Audio", AudioConstructor);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("creates Audio instance and calls play()", () => {
      playSound("/sounds/alert-01.aac");
      expect(vi.mocked(globalThis.Audio)).toHaveBeenCalledWith(
        "/sounds/alert-01.aac",
      );
      expect(mockAudioInstance.play).toHaveBeenCalled();
    });

    it("returns cleanup function that pauses and resets audio", () => {
      const cleanup = playSound("/sounds/alert-01.aac");
      expect(cleanup).toBeDefined();
      cleanup!();
      expect(mockAudioInstance.pause).toHaveBeenCalled();
      expect(mockAudioInstance.currentTime).toBe(0);
    });

    it("returns undefined for undefined src", () => {
      const result = playSound(undefined);
      expect(result).toBeUndefined();
      expect(vi.mocked(globalThis.Audio)).not.toHaveBeenCalled();
    });

    it("returns undefined for empty string src", () => {
      const result = playSound("");
      expect(result).toBeUndefined();
      expect(vi.mocked(globalThis.Audio)).not.toHaveBeenCalled();
    });

    it("silently catches play() rejection", () => {
      mockAudioInstance.play.mockRejectedValueOnce(new Error("Network error"));
      expect(() => playSound("/sounds/alert-01.aac")).not.toThrow();
    });

    it("returns undefined when Audio is not available", () => {
      vi.unstubAllGlobals();
      // @ts-expect-error - testing undefined Audio
      globalThis.Audio = undefined;
      const result = playSound("/sounds/alert-01.aac");
      expect(result).toBeUndefined();
    });
  });

  describe("updateSoundSettings and getSoundSettings", () => {
    afterEach(() => {
      updateSoundSettings({ ...DEFAULT_SOUND_SETTINGS });
    });

    it("roundtrips settings through update and get", () => {
      const settings: SoundSettings = {
        agentEnabled: true,
        agentSoundId: "alert-01",
        permissionsEnabled: true,
        permissionsSoundId: "bip-bop-05",
        errorsEnabled: false,
        errorsSoundId: "nope-10",
      };
      updateSoundSettings(settings);
      expect(getSoundSettings()).toEqual(settings);
    });

    it("updates only modified fields", () => {
      const initial = getSoundSettings();
      const updated: SoundSettings = {
        ...initial,
        agentEnabled: !initial.agentEnabled,
      };
      updateSoundSettings(updated);
      expect(getSoundSettings().agentEnabled).not.toBe(initial.agentEnabled);
      expect(getSoundSettings().permissionsEnabled).toBe(
        initial.permissionsEnabled,
      );
    });
  });

  describe("playSoundForEvent", () => {
    let mockAudioInstance: {
      play: ReturnType<typeof vi.fn>;
      pause: ReturnType<typeof vi.fn>;
      currentTime: number;
    };

    beforeEach(() => {
      mockAudioInstance = {
        play: vi.fn().mockResolvedValue(undefined),
        pause: vi.fn(),
        currentTime: 0,
      };
      const AudioConstructor = vi.fn(function (this: typeof mockAudioInstance) {
        this.play = mockAudioInstance.play;
        this.pause = mockAudioInstance.pause;
        this.currentTime = mockAudioInstance.currentTime;
      }) as unknown as typeof Audio;
      vi.stubGlobal("Audio", AudioConstructor);
      updateSoundSettings({ ...DEFAULT_SOUND_SETTINGS });
    });

    afterEach(() => {
      vi.unstubAllGlobals();
      updateSoundSettings({ ...DEFAULT_SOUND_SETTINGS });
    });

    it("plays agent sound when agentEnabled is true", () => {
      updateSoundSettings({
        agentEnabled: true,
        agentSoundId: "alert-01",
        permissionsEnabled: false,
        permissionsSoundId: "staplebops-02",
        errorsEnabled: false,
        errorsSoundId: "nope-03",
      });
      playSoundForEvent("agent");
      expect(vi.mocked(globalThis.Audio)).toHaveBeenCalledWith(
        "/sounds/alert-01.aac",
      );
      expect(mockAudioInstance.play).toHaveBeenCalled();
    });

    it("does not play agent sound when agentEnabled is false", () => {
      updateSoundSettings({
        agentEnabled: false,
        agentSoundId: "alert-01",
        permissionsEnabled: false,
        permissionsSoundId: "staplebops-02",
        errorsEnabled: false,
        errorsSoundId: "nope-03",
      });
      playSoundForEvent("agent");
      expect(vi.mocked(globalThis.Audio)).not.toHaveBeenCalled();
    });

    it("plays permissions sound when permissionsEnabled is true", () => {
      updateSoundSettings({
        agentEnabled: false,
        agentSoundId: "alert-01",
        permissionsEnabled: true,
        permissionsSoundId: "bip-bop-03",
        errorsEnabled: false,
        errorsSoundId: "nope-03",
      });
      playSoundForEvent("permissions");
      expect(vi.mocked(globalThis.Audio)).toHaveBeenCalledWith(
        "/sounds/bip-bop-03.aac",
      );
      expect(mockAudioInstance.play).toHaveBeenCalled();
    });

    it("does not play permissions sound when permissionsEnabled is false", () => {
      updateSoundSettings({
        agentEnabled: false,
        agentSoundId: "alert-01",
        permissionsEnabled: false,
        permissionsSoundId: "bip-bop-03",
        errorsEnabled: false,
        errorsSoundId: "nope-03",
      });
      playSoundForEvent("permissions");
      expect(vi.mocked(globalThis.Audio)).not.toHaveBeenCalled();
    });

    it("plays errors sound when errorsEnabled is true", () => {
      updateSoundSettings({
        agentEnabled: false,
        agentSoundId: "alert-01",
        permissionsEnabled: false,
        permissionsSoundId: "staplebops-02",
        errorsEnabled: true,
        errorsSoundId: "nope-05",
      });
      playSoundForEvent("errors");
      expect(vi.mocked(globalThis.Audio)).toHaveBeenCalledWith(
        "/sounds/nope-05.aac",
      );
      expect(mockAudioInstance.play).toHaveBeenCalled();
    });

    it("does not play errors sound when errorsEnabled is false", () => {
      updateSoundSettings({
        agentEnabled: false,
        agentSoundId: "alert-01",
        permissionsEnabled: false,
        permissionsSoundId: "staplebops-02",
        errorsEnabled: false,
        errorsSoundId: "nope-05",
      });
      playSoundForEvent("errors");
      expect(vi.mocked(globalThis.Audio)).not.toHaveBeenCalled();
    });
  });
});

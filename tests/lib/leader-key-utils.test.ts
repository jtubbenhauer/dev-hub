import { describe, it, expect } from "vitest"
import {
  matchesActivationKey,
  formatActivationKey,
  isActivationKeyEqual,
  findMatchingPresetId,
  isValidActivationKeyConfig,
  ACTIVATION_KEY_PRESETS,
  DEFAULT_ACTIVATION_KEY,
} from "@/lib/leader-key-utils"
import type { ActivationKeyConfig } from "@/types/leader-key"

function makeKeyboardEvent(overrides: Partial<KeyboardEvent>): KeyboardEvent {
  return {
    key: "",
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    ...overrides,
  } as KeyboardEvent
}

describe("leader-key-utils", () => {
  describe("matchesActivationKey", () => {
    it("matches Ctrl+Space (default)", () => {
      const config: ActivationKeyConfig = { key: " ", ctrlKey: true }
      const event = makeKeyboardEvent({ key: " ", ctrlKey: true })
      expect(matchesActivationKey(event, config)).toBe(true)
    })

    it("rejects when wrong key is pressed", () => {
      const config: ActivationKeyConfig = { key: " ", ctrlKey: true }
      const event = makeKeyboardEvent({ key: "a", ctrlKey: true })
      expect(matchesActivationKey(event, config)).toBe(false)
    })

    it("rejects when required modifier is missing", () => {
      const config: ActivationKeyConfig = { key: " ", ctrlKey: true }
      const event = makeKeyboardEvent({ key: " ", ctrlKey: false })
      expect(matchesActivationKey(event, config)).toBe(false)
    })

    it("rejects when extra modifier is present", () => {
      const config: ActivationKeyConfig = { key: " ", ctrlKey: true }
      const event = makeKeyboardEvent({ key: " ", ctrlKey: true, shiftKey: true })
      expect(matchesActivationKey(event, config)).toBe(false)
    })

    it("matches Alt+Space", () => {
      const config: ActivationKeyConfig = { key: " ", altKey: true }
      const event = makeKeyboardEvent({ key: " ", altKey: true })
      expect(matchesActivationKey(event, config)).toBe(true)
    })

    it("matches Ctrl+Shift+Space", () => {
      const config: ActivationKeyConfig = { key: " ", ctrlKey: true, shiftKey: true }
      const event = makeKeyboardEvent({ key: " ", ctrlKey: true, shiftKey: true })
      expect(matchesActivationKey(event, config)).toBe(true)
    })

    it("matches Ctrl+.", () => {
      const config: ActivationKeyConfig = { key: ".", ctrlKey: true }
      const event = makeKeyboardEvent({ key: ".", ctrlKey: true })
      expect(matchesActivationKey(event, config)).toBe(true)
    })

    it("matches Meta+. (Cmd+. on Mac)", () => {
      const config: ActivationKeyConfig = { key: ".", metaKey: true }
      const event = makeKeyboardEvent({ key: ".", metaKey: true })
      expect(matchesActivationKey(event, config)).toBe(true)
    })

    it("treats undefined modifiers as false", () => {
      const config: ActivationKeyConfig = { key: " ", ctrlKey: true }
      const event = makeKeyboardEvent({ key: " ", ctrlKey: true, altKey: false, shiftKey: false, metaKey: false })
      expect(matchesActivationKey(event, config)).toBe(true)
    })
  })

  describe("formatActivationKey", () => {
    it("formats Ctrl+Space for non-Mac", () => {
      expect(formatActivationKey({ key: " ", ctrlKey: true }, false)).toBe("Ctrl+Space")
    })

    it("formats Ctrl+Space for Mac as ⌃Space", () => {
      expect(formatActivationKey({ key: " ", ctrlKey: true }, true)).toBe("⌃Space")
    })

    it("formats Alt+Space for non-Mac", () => {
      expect(formatActivationKey({ key: " ", altKey: true }, false)).toBe("Alt+Space")
    })

    it("formats Alt+Space for Mac as ⌥Space", () => {
      expect(formatActivationKey({ key: " ", altKey: true }, true)).toBe("⌥Space")
    })

    it("formats Ctrl+Shift+Space for non-Mac", () => {
      expect(formatActivationKey({ key: " ", ctrlKey: true, shiftKey: true }, false)).toBe("Ctrl+Shift+Space")
    })

    it("formats Ctrl+Shift+Space for Mac as ⌃⇧Space", () => {
      expect(formatActivationKey({ key: " ", ctrlKey: true, shiftKey: true }, true)).toBe("⌃⇧Space")
    })

    it("formats Ctrl+. for non-Mac", () => {
      expect(formatActivationKey({ key: ".", ctrlKey: true }, false)).toBe("Ctrl+.")
    })

    it("formats Ctrl+. for Mac as ⌃.", () => {
      expect(formatActivationKey({ key: ".", ctrlKey: true }, true)).toBe("⌃.")
    })

    it("formats Meta+; for Mac as ⌘;", () => {
      expect(formatActivationKey({ key: ";", metaKey: true }, true)).toBe("⌘;")
    })

    it("formats Meta+; for non-Mac as Super+;", () => {
      expect(formatActivationKey({ key: ";", metaKey: true }, false)).toBe("Super+;")
    })

    it("uppercases single-char keys", () => {
      expect(formatActivationKey({ key: "k", ctrlKey: true }, false)).toBe("Ctrl+K")
    })
  })

  describe("isActivationKeyEqual", () => {
    it("returns true for identical configs", () => {
      const a: ActivationKeyConfig = { key: " ", ctrlKey: true }
      const b: ActivationKeyConfig = { key: " ", ctrlKey: true }
      expect(isActivationKeyEqual(a, b)).toBe(true)
    })

    it("returns true when unset modifiers match falsy", () => {
      const a: ActivationKeyConfig = { key: " ", ctrlKey: true }
      const b: ActivationKeyConfig = { key: " ", ctrlKey: true, altKey: false, shiftKey: false }
      expect(isActivationKeyEqual(a, b)).toBe(true)
    })

    it("returns false for different keys", () => {
      const a: ActivationKeyConfig = { key: " ", ctrlKey: true }
      const b: ActivationKeyConfig = { key: ".", ctrlKey: true }
      expect(isActivationKeyEqual(a, b)).toBe(false)
    })

    it("returns false for different modifiers", () => {
      const a: ActivationKeyConfig = { key: " ", ctrlKey: true }
      const b: ActivationKeyConfig = { key: " ", altKey: true }
      expect(isActivationKeyEqual(a, b)).toBe(false)
    })
  })

  describe("findMatchingPresetId", () => {
    it("finds ctrl+space preset for the default config", () => {
      expect(findMatchingPresetId(DEFAULT_ACTIVATION_KEY)).toBe("ctrl+space")
    })

    it("finds alt+space preset", () => {
      expect(findMatchingPresetId({ key: " ", altKey: true })).toBe("alt+space")
    })

    it("returns null for a custom config", () => {
      expect(findMatchingPresetId({ key: "k", ctrlKey: true })).toBeNull()
    })
  })

  describe("isValidActivationKeyConfig", () => {
    it("validates a correct config", () => {
      expect(isValidActivationKeyConfig({ key: " ", ctrlKey: true })).toBe(true)
    })

    it("rejects config without a modifier", () => {
      expect(isValidActivationKeyConfig({ key: " " })).toBe(false)
    })

    it("rejects config with empty key", () => {
      expect(isValidActivationKeyConfig({ key: "", ctrlKey: true })).toBe(false)
    })

    it("rejects null", () => {
      expect(isValidActivationKeyConfig(null)).toBe(false)
    })

    it("rejects string", () => {
      expect(isValidActivationKeyConfig("ctrl+space")).toBe(false)
    })

    it("rejects arrays", () => {
      expect(isValidActivationKeyConfig([" ", true])).toBe(false)
    })
  })

  describe("ACTIVATION_KEY_PRESETS", () => {
    it("has at least 4 presets", () => {
      expect(ACTIVATION_KEY_PRESETS.length).toBeGreaterThanOrEqual(4)
    })

    it("all presets have unique IDs", () => {
      const ids = ACTIVATION_KEY_PRESETS.map((p) => p.id)
      expect(new Set(ids).size).toBe(ids.length)
    })

    it("all preset configs are valid", () => {
      for (const preset of ACTIVATION_KEY_PRESETS) {
        expect(isValidActivationKeyConfig(preset.config)).toBe(true)
      }
    })

    it("includes the default activation key as first preset", () => {
      expect(isActivationKeyEqual(ACTIVATION_KEY_PRESETS[0].config, DEFAULT_ACTIVATION_KEY)).toBe(true)
    })
  })
})

import { describe, it, expect } from 'vitest'
import { pickNextColor, assignColorsToUncolored } from '@/lib/workspace-color-utils'
import { WORKSPACE_PRESET_COLORS } from '@/lib/utils'

describe('workspace-color-utils', () => {
  describe('pickNextColor', () => {
    it('returns the first preset color when no workspaces exist', () => {
      expect(pickNextColor([])).toBe(WORKSPACE_PRESET_COLORS[0])
    })

    it('returns the first unused preset color when some are used', () => {
      const workspaces = [
        { id: '1', color: WORKSPACE_PRESET_COLORS[0] },
      ]
      expect(pickNextColor(workspaces)).toBe(WORKSPACE_PRESET_COLORS[1])
    })

    it('picks the least-used color', () => {
      const workspaces = [
        { id: '1', color: WORKSPACE_PRESET_COLORS[0] },
        { id: '2', color: WORKSPACE_PRESET_COLORS[0] },
        { id: '3', color: WORKSPACE_PRESET_COLORS[1] },
      ]
      // Colors 2-9 have 0 uses, so it should pick the first one with 0 uses
      expect(pickNextColor(workspaces)).toBe(WORKSPACE_PRESET_COLORS[2])
    })

    it('cycles back to least-used when all colors are used', () => {
      const workspaces = WORKSPACE_PRESET_COLORS.map((color, i) => ({
        id: String(i),
        color,
      }))
      // All colors used once — ties broken by preset order, so first preset wins
      expect(pickNextColor(workspaces)).toBe(WORKSPACE_PRESET_COLORS[0])
    })

    it('skips workspaces with null color', () => {
      const workspaces = [
        { id: '1', color: null },
        { id: '2', color: null },
      ]
      expect(pickNextColor(workspaces)).toBe(WORKSPACE_PRESET_COLORS[0])
    })

    it('ignores non-preset colors', () => {
      const workspaces = [
        { id: '1', color: '#ffffff' },
        { id: '2', color: '#000000' },
      ]
      // Non-preset colors are ignored, all presets have 0 count
      expect(pickNextColor(workspaces)).toBe(WORKSPACE_PRESET_COLORS[0])
    })

    it('handles mixed null and preset colors', () => {
      const workspaces = [
        { id: '1', color: WORKSPACE_PRESET_COLORS[0] },
        { id: '2', color: null },
        { id: '3', color: WORKSPACE_PRESET_COLORS[0] },
        { id: '4', color: null },
      ]
      expect(pickNextColor(workspaces)).toBe(WORKSPACE_PRESET_COLORS[1])
    })
  })

  describe('assignColorsToUncolored', () => {
    it('returns empty map when all workspaces have colors', () => {
      const workspaces = [
        { id: '1', color: WORKSPACE_PRESET_COLORS[0] },
        { id: '2', color: WORKSPACE_PRESET_COLORS[1] },
      ]
      const result = assignColorsToUncolored(workspaces)
      expect(result.size).toBe(0)
    })

    it('returns empty map when no workspaces exist', () => {
      const result = assignColorsToUncolored([])
      expect(result.size).toBe(0)
    })

    it('assigns the first preset color to a single uncolored workspace', () => {
      const workspaces = [{ id: '1', color: null }]
      const result = assignColorsToUncolored(workspaces)
      expect(result.size).toBe(1)
      expect(result.get('1')).toBe(WORKSPACE_PRESET_COLORS[0])
    })

    it('distributes colors evenly across multiple uncolored workspaces', () => {
      const workspaces = [
        { id: '1', color: null },
        { id: '2', color: null },
        { id: '3', color: null },
      ]
      const result = assignColorsToUncolored(workspaces)
      expect(result.size).toBe(3)
      expect(result.get('1')).toBe(WORKSPACE_PRESET_COLORS[0])
      expect(result.get('2')).toBe(WORKSPACE_PRESET_COLORS[1])
      expect(result.get('3')).toBe(WORKSPACE_PRESET_COLORS[2])
    })

    it('skips already-colored workspaces and accounts for their colors', () => {
      const workspaces = [
        { id: '1', color: WORKSPACE_PRESET_COLORS[0] },
        { id: '2', color: null },
        { id: '3', color: WORKSPACE_PRESET_COLORS[1] },
        { id: '4', color: null },
      ]
      const result = assignColorsToUncolored(workspaces)
      expect(result.size).toBe(2)
      // Colors 0 and 1 each have 1 use, so uncolored get colors 2 and 3
      expect(result.get('2')).toBe(WORKSPACE_PRESET_COLORS[2])
      expect(result.get('4')).toBe(WORKSPACE_PRESET_COLORS[3])
    })

    it('cycles colors when more uncolored workspaces than presets', () => {
      const uncolored = Array.from({ length: 12 }, (_, i) => ({
        id: String(i),
        color: null,
      }))
      const result = assignColorsToUncolored(uncolored)
      expect(result.size).toBe(12)
      // First 10 get one each, then 11th and 12th cycle back
      expect(result.get('10')).toBe(WORKSPACE_PRESET_COLORS[0])
      expect(result.get('11')).toBe(WORKSPACE_PRESET_COLORS[1])
    })

    it('does not modify the input array', () => {
      const workspaces = [
        { id: '1', color: null },
        { id: '2', color: null },
      ]
      const copy = workspaces.map((ws) => ({ ...ws }))
      assignColorsToUncolored(workspaces)
      expect(workspaces).toEqual(copy)
    })
  })
})

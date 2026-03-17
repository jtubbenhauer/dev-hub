import { WORKSPACE_PRESET_COLORS } from "@/lib/utils"

export interface WorkspaceWithColor {
  id: string
  color: string | null
}

export function pickNextColor(existingWorkspaces: WorkspaceWithColor[]): string {
  const colorCounts = new Map<string, number>()
  for (const preset of WORKSPACE_PRESET_COLORS) {
    colorCounts.set(preset, 0)
  }
  for (const ws of existingWorkspaces) {
    if (ws.color && colorCounts.has(ws.color)) {
      colorCounts.set(ws.color, colorCounts.get(ws.color)! + 1)
    }
  }
  let bestColor = WORKSPACE_PRESET_COLORS[0] as string
  let lowestCount = Infinity
  for (const [color, count] of colorCounts) {
    if (count < lowestCount) {
      bestColor = color
      lowestCount = count
    }
  }
  return bestColor
}

export function assignColorsToUncolored(
  workspaces: WorkspaceWithColor[]
): Map<string, string> {
  const assignments = new Map<string, string>()
  const colorCounts = new Map<string, number>()
  for (const preset of WORKSPACE_PRESET_COLORS) {
    colorCounts.set(preset, 0)
  }
  for (const ws of workspaces) {
    if (ws.color && colorCounts.has(ws.color)) {
      colorCounts.set(ws.color, colorCounts.get(ws.color)! + 1)
    }
  }
  for (const ws of workspaces) {
    if (!ws.color) {
      let bestColor = WORKSPACE_PRESET_COLORS[0] as string
      let lowestCount = Infinity
      for (const [color, count] of colorCounts) {
        if (count < lowestCount) {
          bestColor = color
          lowestCount = count
        }
      }
      assignments.set(ws.id, bestColor)
      colorCounts.set(bestColor, lowestCount + 1)
    }
  }
  return assignments
}

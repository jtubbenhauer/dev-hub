"use client"

import { createContext, useContext, useEffect, useState } from "react"
import type { AppTheme } from "@/hooks/use-settings"
import { useSettingsMutation, SETTINGS_KEYS } from "@/hooks/use-settings"

export interface ThemeContextValue {
  theme: AppTheme
  setTheme: (theme: AppTheme) => void
  resolvedMode: "dark" | "light"
  flavor: string | null
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: "system",
  setTheme: () => {},
  resolvedMode: "dark",
  flavor: null,
})

function getResolvedMode(theme: AppTheme): "dark" | "light" {
  if (theme === "catppuccin-latte" || theme === "default-light") return "light"
  if (theme === "system") {
    return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light"
  }
  return "dark"
}

function getFlavor(theme: AppTheme): string | null {
  if (theme.startsWith("catppuccin-")) return theme.replace("catppuccin-", "")
  return null
}

function applyThemeClasses(theme: AppTheme) {
  if (typeof document === "undefined") return
  const root = document.documentElement
  root.classList.remove("light", "dark", "catppuccin-latte", "catppuccin-frappe", "catppuccin-macchiato", "catppuccin-mocha", "dracula", "github-dark")

  switch (theme) {
    case "catppuccin-mocha":       root.classList.add("dark", "catppuccin-mocha"); break
    case "catppuccin-macchiato":   root.classList.add("dark", "catppuccin-macchiato"); break
    case "catppuccin-frappe":      root.classList.add("dark", "catppuccin-frappe"); break
    case "catppuccin-latte":       root.classList.add("light", "catppuccin-latte"); break
    case "dracula":                root.classList.add("dark", "dracula"); break
    case "github-dark":            root.classList.add("dark", "github-dark"); break
    case "default-dark":           root.classList.add("dark"); break
    case "default-light":          root.classList.add("light"); break
    default: {
      const systemDark = typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches
      root.classList.add(systemDark ? "dark" : "light")
    }
  }
}

const STORAGE_KEY = "dev-hub-theme"

function migrateStoredTheme(raw: string | null): AppTheme {
  if (!raw) return "system"
  if (raw === "dark") return "default-dark"
  if (raw === "light") return "default-light"
  const valid: AppTheme[] = ["system", "default-dark", "default-light", "catppuccin-latte", "catppuccin-frappe", "catppuccin-macchiato", "catppuccin-mocha", "dracula", "github-dark"]
  return valid.includes(raw as AppTheme) ? (raw as AppTheme) : "system"
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<AppTheme>("system")
  const { mutate: saveSetting } = useSettingsMutation()

  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY)
    const migrated = migrateStoredTheme(raw)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setThemeState(migrated)
    applyThemeClasses(migrated)
  }, [])

  useEffect(() => {
    applyThemeClasses(theme)
    localStorage.setItem(STORAGE_KEY, theme)
  }, [theme])

  useEffect(() => {
    if (theme !== "system") return
    const mq = window.matchMedia("(prefers-color-scheme: dark)")
    const handler = () => applyThemeClasses("system")
    mq.addEventListener("change", handler)
    return () => mq.removeEventListener("change", handler)
  }, [theme])

  const setTheme = (newTheme: AppTheme) => {
    setThemeState(newTheme)
    saveSetting({ key: SETTINGS_KEYS.THEME, value: newTheme })
  }

  const resolvedMode = getResolvedMode(theme)
  const flavor = getFlavor(theme)

  return (
    <ThemeContext.Provider value={{ theme, setTheme, resolvedMode, flavor }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  return useContext(ThemeContext)
}

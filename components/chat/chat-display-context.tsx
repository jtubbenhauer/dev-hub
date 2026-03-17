"use client"

import { createContext, useContext } from "react"

export interface ChatDisplaySettings {
  showThinking: boolean
  showToolCalls: boolean
  showTokens: boolean
  showTimestamps: boolean
}

const defaultSettings: ChatDisplaySettings = {
  showThinking: true,
  showToolCalls: true,
  showTokens: true,
  showTimestamps: false,
}

export const ChatDisplayContext = createContext<ChatDisplaySettings>(defaultSettings)

export function useChatDisplay() {
  return useContext(ChatDisplayContext)
}

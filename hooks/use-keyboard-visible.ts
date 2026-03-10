"use client"

import { useState, useEffect } from "react"

const KEYBOARD_THRESHOLD = 0.75

export function useKeyboardVisible() {
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false)

  useEffect(() => {
    const visualViewport = window.visualViewport
    if (!visualViewport) return

    const onResize = () => {
      setIsKeyboardVisible(visualViewport.height < window.innerHeight * KEYBOARD_THRESHOLD)
    }

    visualViewport.addEventListener("resize", onResize)
    return () => visualViewport.removeEventListener("resize", onResize)
  }, [])

  return isKeyboardVisible
}

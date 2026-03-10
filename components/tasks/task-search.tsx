"use client"

import { useState, useEffect, useRef } from "react"
import { Search, X } from "lucide-react"
import { Input } from "@/components/ui/input"

interface TaskSearchProps {
  value: string
  onChange: (query: string) => void
  placeholder?: string
  className?: string
}

export function TaskSearch({ value, onChange, placeholder = "Search tasks...", className }: TaskSearchProps) {
  const [localValue, setLocalValue] = useState(value)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Sync prop changes in (e.g. when cleared externally)
  useEffect(() => {
    setLocalValue(value)
  }, [value])

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const next = e.target.value
    setLocalValue(next)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => onChange(next), 300)
  }

  function handleClear() {
    setLocalValue("")
    if (debounceRef.current) clearTimeout(debounceRef.current)
    onChange("")
  }

  return (
    <div className={`relative ${className ?? ""}`}>
      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
      <Input
        value={localValue}
        onChange={handleChange}
        placeholder={placeholder}
        className="pl-8 pr-7 h-8 text-sm"
      />
      {localValue && (
        <button
          onClick={handleClear}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  )
}

"use client"

import { useState } from "react"
import { ChevronsUpDown, Check, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Command,
  CommandEmpty,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { cn } from "@/lib/utils"

interface VariantSelectorProps {
  variants: string[]
  selectedVariant: string | null
  onVariantChange: (variant: string | null) => void
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export function VariantSelector({
  variants,
  selectedVariant,
  onVariantChange,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}: VariantSelectorProps) {
  const [internalOpen, setInternalOpen] = useState(false)

  const isOpen = controlledOpen !== undefined ? controlledOpen : internalOpen
  const setIsOpen = controlledOnOpenChange !== undefined
    ? controlledOnOpenChange
    : setInternalOpen

  if (variants.length === 0) return null

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          role="combobox"
          aria-expanded={isOpen}
          className="max-w-[120px] gap-1.5 text-xs"
        >
          <Sparkles className="size-3 shrink-0" />
          <span className="truncate capitalize">
            {selectedVariant ?? "default"}
          </span>
          <ChevronsUpDown className="size-3 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[160px] p-0" align="end">
        <Command>
          <CommandList>
            <CommandEmpty>No variants.</CommandEmpty>
            <CommandItem
              value="__default__"
              onSelect={() => {
                onVariantChange(null)
                setIsOpen(false)
              }}
            >
              <Check className={cn("size-3", !selectedVariant ? "opacity-100" : "opacity-0")} />
              Default
            </CommandItem>
            {variants.map((v) => {
              const isSelected = selectedVariant === v
              return (
                <CommandItem
                  key={v}
                  value={v}
                  onSelect={() => {
                    onVariantChange(v)
                    setIsOpen(false)
                  }}
                >
                  <Check className={cn("size-3", isSelected ? "opacity-100" : "opacity-0")} />
                  <span className="capitalize">{v}</span>
                </CommandItem>
              )
            })}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

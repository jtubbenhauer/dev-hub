"use client";

import { useState, useEffect, useRef } from "react";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";

interface TaskSearchProps {
  value: string;
  onChange: (query: string) => void;
  placeholder?: string;
  className?: string;
  searchInputRef?: React.Ref<HTMLInputElement>;
}

export function TaskSearch({
  value,
  onChange,
  placeholder = "Search tasks...",
  className,
  searchInputRef,
}: TaskSearchProps) {
  const [localValue, setLocalValue] = useState(value);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync prop changes in (e.g. when cleared externally)
  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const next = e.target.value;
    setLocalValue(next);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => onChange(next), 300);
  }

  function handleClear() {
    setLocalValue("");
    if (debounceRef.current) clearTimeout(debounceRef.current);
    onChange("");
  }

  return (
    <div className={`relative ${className ?? ""}`}>
      <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
      <Input
        ref={searchInputRef}
        value={localValue}
        onChange={handleChange}
        placeholder={placeholder}
        className="h-8 pr-7 pl-8 text-sm"
      />
      {localValue && (
        <button
          onClick={handleClear}
          className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2 -translate-y-1/2 transition-colors"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}

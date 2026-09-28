"use client";

import { useState } from "react";

interface SessionTitleEditorProps {
  initialTitle: string;
  onSave: (title: string) => Promise<boolean>;
  onDone: () => void;
}

export function SessionTitleEditor({
  initialTitle,
  onSave,
  onDone,
}: SessionTitleEditorProps) {
  const [title, setTitle] = useState(initialTitle);
  const [isSaving, setIsSaving] = useState(false);

  const save = async () => {
    if (isSaving) return;
    const trimmedTitle = title.trim();
    if (trimmedTitle.length === 0 || trimmedTitle === initialTitle) {
      onDone();
      return;
    }
    setIsSaving(true);
    await onSave(trimmedTitle);
    setIsSaving(false);
    onDone();
  };

  return (
    <input
      aria-label="Session title"
      autoFocus
      value={title}
      disabled={isSaving}
      onChange={(event) => setTitle(event.target.value)}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") {
          event.preventDefault();
          void save();
        } else if (event.key === "Escape") {
          event.preventDefault();
          onDone();
        }
      }}
      onBlur={() => void save()}
      className="border-input bg-background focus-visible:ring-ring w-full rounded-sm border px-1 py-0.5 text-sm font-medium outline-none focus-visible:ring-1"
    />
  );
}

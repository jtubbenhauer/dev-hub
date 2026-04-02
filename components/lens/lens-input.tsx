"use client";

import { memo, useState, useCallback, useRef } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";

interface LensInputProps {
  onSubmit: (text: string) => void;
  disabled?: boolean;
  isStreaming?: boolean;
}

export const LensInput = memo(function LensInput({
  onSubmit,
  disabled,
  isStreaming,
}: LensInputProps) {
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
    setText("");
    requestAnimationFrame(() => {
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }
    });
  }, [text, onSubmit]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  const handleInput = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setText(e.target.value);
      const el = e.target;
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
    },
    [],
  );

  const isDisabled = disabled || isStreaming;

  return (
    <div className="border-t px-4 py-3">
      <div className="bg-muted/50 flex items-end gap-2 rounded-lg border px-3 py-2">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          placeholder={
            isStreaming ? "Waiting for response..." : "Ask Lens anything..."
          }
          disabled={isDisabled}
          rows={1}
          className="placeholder:text-muted-foreground max-h-[200px] min-h-[24px] flex-1 resize-none border-none bg-transparent text-sm outline-none disabled:opacity-50"
        />
        <Button
          size="icon-xs"
          variant="ghost"
          onClick={handleSubmit}
          disabled={isDisabled || !text.trim()}
          title="Send message"
        >
          <Send className="size-4" />
        </Button>
      </div>
    </div>
  );
});

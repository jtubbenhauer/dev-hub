"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const MAX_LENGTH = 2000;

interface CommentInputProps {
  startLine: number;
  endLine: number;
  filePath: string;
  onSubmit: (body: string) => void;
  onCancel: () => void;
  initialBody?: string;
}

function formatHeader(
  filePath: string,
  startLine: number,
  endLine: number,
): string {
  const fileName = filePath.split("/").pop() ?? filePath;
  if (startLine === endLine) {
    return `${fileName}:${startLine}`;
  }
  return `${fileName}:${startLine}-${endLine}`;
}

export function CommentInput({
  startLine,
  endLine,
  filePath,
  onSubmit,
  onCancel,
  initialBody = "",
}: CommentInputProps) {
  const [body, setBody] = useState(initialBody);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const handleSubmit = useCallback(() => {
    const trimmed = body.trim();
    if (!trimmed || trimmed.length > MAX_LENGTH) return;
    onSubmit(trimmed);
  }, [body, onSubmit]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const value = e.target.value;
      if (value.length <= MAX_LENGTH) {
        setBody(value);
      }
    },
    [],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit, onCancel],
  );

  const trimmedBody = body.trim();
  const isSubmitDisabled = !trimmedBody || body.length > MAX_LENGTH;

  return (
    <div className="border-border bg-card flex flex-col gap-2 rounded-md border p-3 text-sm shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground font-mono text-xs">
          {formatHeader(filePath, startLine, endLine)}
        </span>
      </div>

      <textarea
        ref={textareaRef}
        value={body}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder="Add a comment… (Enter to submit, Shift+Enter for newline)"
        rows={3}
        className={cn(
          "border-input bg-background w-full resize-none rounded-md border px-3 py-2 text-sm",
          "placeholder:text-muted-foreground",
          "focus-visible:ring-ring outline-none focus-visible:ring-1",
          "disabled:cursor-not-allowed disabled:opacity-50",
        )}
      />

      <div className="flex items-center justify-between gap-2">
        <span
          className={cn(
            "text-muted-foreground text-xs",
            body.length > MAX_LENGTH && "text-destructive",
          )}
        >
          {body.length}/{MAX_LENGTH}
        </span>

        <div className="flex gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={onCancel}
            aria-label="Cancel"
          >
            <X className="size-3.5" />
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={isSubmitDisabled}
            aria-label="Submit"
          >
            <Send className="size-3.5" />
            Submit
          </Button>
        </div>
      </div>
    </div>
  );
}

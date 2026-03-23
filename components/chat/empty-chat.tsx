"use client";

import { Button } from "@/components/ui/button";

const suggestions = [
  "What files are in this project?",
  "Explain the project structure",
  "Find and fix any bugs",
  "Write tests for the main module",
];

export function EmptyChat({ onSend }: { onSend: (text: string) => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 p-8">
      <div className="text-center">
        <h2 className="text-xl font-semibold">Start a conversation</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Ask OpenCode anything about your project
        </p>
      </div>
      <div className="grid max-w-lg grid-cols-1 gap-2 sm:grid-cols-2">
        {suggestions.map((suggestion) => (
          <Button
            key={suggestion}
            variant="outline"
            className="h-auto px-4 py-3 text-left text-sm whitespace-normal"
            onClick={() => onSend(suggestion)}
          >
            {suggestion}
          </Button>
        ))}
      </div>
    </div>
  );
}

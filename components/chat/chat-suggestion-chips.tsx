interface ChatSuggestionChipsProps {
  replies: string[];
  onSelect: (reply: string) => void;
}

export function ChatSuggestionChips({
  replies,
  onSelect,
}: ChatSuggestionChipsProps) {
  if (replies.length === 0) return null;
  return (
    <div
      className="animate-in fade-in flex gap-1.5 overflow-x-auto px-3 pt-2 pb-0.5 duration-150 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      data-testid="chat-suggestion-chips"
    >
      {replies.map((reply) => (
        <button
          key={reply}
          type="button"
          onClick={() => onSelect(reply)}
          className="bg-background text-muted-foreground hover:text-foreground max-w-[16rem] shrink-0 truncate rounded-full border px-3 py-1 text-xs"
        >
          {reply}
        </button>
      ))}
    </div>
  );
}

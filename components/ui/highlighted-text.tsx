import type { ReactNode } from "react";

interface HighlightedTextProps {
  text: string;
  positions: Set<number>;
}

export function HighlightedText({ text, positions }: HighlightedTextProps) {
  if (positions.size === 0) return <>{text}</>;

  const parts: ReactNode[] = [];
  let i = 0;
  while (i < text.length) {
    if (positions.has(i)) {
      let end = i;
      while (end < text.length && positions.has(end)) end++;
      parts.push(
        <span key={i} className="text-primary font-semibold">
          {text.slice(i, end)}
        </span>,
      );
      i = end;
    } else {
      let end = i;
      while (end < text.length && !positions.has(end)) end++;
      parts.push(<span key={i}>{text.slice(i, end)}</span>);
      i = end;
    }
  }

  return <>{parts}</>;
}

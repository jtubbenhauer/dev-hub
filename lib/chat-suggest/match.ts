// Returns the untyped remainder of the first candidate that the typed text is a
// prefix of, or null. Case-insensitive so "ok" still matches "Ok great…".
export function findCandidateRemainder(
  typedText: string,
  candidates: string[],
): string | null {
  if (typedText.trim().length === 0) return null;
  const typedLower = typedText.toLowerCase();
  for (const candidate of candidates) {
    if (
      candidate.length > typedText.length &&
      candidate.toLowerCase().startsWith(typedLower)
    ) {
      return candidate.slice(typedText.length);
    }
  }
  return null;
}

export interface LiveCompletion {
  typedText: string;
  completion: string;
}

// A live completion stays valid while the user types through it.
export function getLiveCompletionRemainder(
  typedText: string,
  liveCompletion: LiveCompletion | null,
): string | null {
  if (!liveCompletion || typedText.trim().length === 0) return null;
  const fullText = liveCompletion.typedText + liveCompletion.completion;
  if (
    typedText.length >= liveCompletion.typedText.length &&
    fullText.length > typedText.length &&
    fullText.startsWith(typedText)
  ) {
    return fullText.slice(typedText.length);
  }
  return null;
}

// Accept up to and including the next word plus trailing whitespace.
export function getNextWordChunk(remainder: string): string {
  const match = remainder.match(/^\s*\S+\s*/);
  return match ? match[0] : remainder;
}

// Default distance (in px) from the bottom within which the viewport is still
// considered "at the bottom". A single mouse-wheel notch typically scrolls
// ~100px, so a user scrolling up even slightly un-pins auto-scroll.
export const AUTO_SCROLL_THRESHOLD_PX = 80;

export interface ScrollMetrics {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

// Returns true when the scroll container is within `threshold` px of the
// bottom. Used to decide whether streaming updates should keep following the
// output or leave the user's scroll position alone.
export function isNearBottom(
  metrics: ScrollMetrics,
  threshold: number = AUTO_SCROLL_THRESHOLD_PX,
): boolean {
  const distanceFromBottom =
    metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight;
  return distanceFromBottom <= threshold;
}

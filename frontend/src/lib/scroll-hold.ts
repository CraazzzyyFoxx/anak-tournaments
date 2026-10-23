/** What the reader does to take the scroll back from a hold. */
const READER_INPUT = ["wheel", "touchstart", "keydown", "pointerdown"] as const;

/**
 * Applies `place` now and again whenever the page changes size, until the
 * reader scrolls, touches, presses a key or `ms` pass. Returns the release.
 *
 * A settings page lands in parts (a lazy Markdown editor, a late query), so a
 * scroll position set when it mounts drifts as the rest arrives above it.
 */
export function holdScrollPosition(place: () => void, ms: number): () => void {
  place();
  const hold = new ResizeObserver(place);
  hold.observe(document.body);
  const release = () => {
    hold.disconnect();
    window.clearTimeout(timer);
    for (const type of READER_INPUT) window.removeEventListener(type, release);
  };
  const timer = window.setTimeout(release, ms);
  for (const type of READER_INPUT) window.addEventListener(type, release, { passive: true });
  return release;
}
